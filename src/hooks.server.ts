// SvelteKit server hook — runs on every request.
// Resolves the authenticated `users` record into `event.locals.user`
// AND attaches a per-request PocketBase client to `event.locals.pb`
// so route handlers don't have to rebuild one from scratch.
//
// Note: quota fields are NOT on the `users` record — they live in
// dedicated collections (`Quota`, `Total_Quota`). Pages that need
// quota state pull it through `$lib/server/quota.ts` helpers.

import type { Handle } from '@sveltejs/kit';
import { createPb } from '$lib/pb/server';
import type { UserRole } from '$lib/types';
import { startPrintJobMonitor } from '$lib/server/functions/monitor/startPrintJobMonitor';
import { getAdminClient } from '$lib/server/functions/pocketbase/getAdminClient';

// Start background print job monitor every 500ms
startPrintJobMonitor(500);

interface UserTypeRef {
    type?: string;
}

interface UserRecord {
    id: string;
    email: string;
    name?: string;
    username?: string;
    user_type?: string | null;
    expand?: {
        user_type?: UserTypeRef;
        Quota_via_user?: Array<{
            id: string;
            user: string;
            Total_Quota: number;
            Quota: string;
            Use: number;
        }>;
    };
}

function resolveRole(record: UserRecord): UserRole {
    // PB returns expanded user under `expand.<field>`, NOT inline on
    // the field itself. `user_type` stays as the user ID, the actual
    // record lives at `record.expand.user_type`.
    const expanded = record.expand?.user_type;
    const typeName = expanded?.type ?? null;
    if (typeName) {
        const lower = typeName.toLowerCase();
        if (lower === 'superadmin') return 'superadmin';
        if (lower === 'admin') return 'admin';
    }
    return 'user';
}

function resolveEmail(record: UserRecord): string {
    if (record.email) return record.email;
    if (record.username) return `${record.username}@cskmitl.internal`;
    return 'unknown@cskmitl.internal';
}

export const handle: Handle = async ({ event, resolve }) => {
    event.locals.pb = createPb(event);

    const pb = event.locals.pb;
    if (pb.authStore.isValid) {
        try {
            await pb.collection('users').authRefresh();
            const userId = pb.authStore.record?.id;
            if (!userId) throw new Error('no user id in auth store');

            const pbAdmin = await getAdminClient();

            // 1. ดึงข้อมูลพนักงาน + ดึงข้อมูลจากคอลเลกชัน Quota (ตารางลูก) ที่ผูกผ่านฟิลด์ user โดยใช้สิทธิ์ Admin
            // เพื่อหลีกเลี่ยงข้อจำกัดของสิทธิ์การเข้าถึง (View/List rules) บนคอลเลกชัน Quota
            let full = (await pbAdmin.collection('users').getOne(userId, {
                expand: 'user_type,Quota_via_user.Total_Quota'
            })) as unknown as any;

            // ดึงข้อมูลผ่านตัวแปรที่เป็นพิมพ์ใหญ่ Quota_via_user ให้ตรงกับ Schema
            let quotaRecord = full.expand?.Quota_via_user?.[0] ?? null;

            // 🌟 2. ถ้าเข้าสู่ระบบครั้งแรกแล้วยังไม่มีประวัติในคอลเลกชัน Quota ให้สร้างอัตโนมัติ
            if (!quotaRecord) {
                try {
                    // ก. ค้นหาแถวโควต้าตั้งต้นจากคอลเลกชัน "Total_Quota" (ตารางแม่) 
                    // ในที่นี้เลือกแถวแรกที่มีอยู่ในระบบขึ้นมาเป็นค่า Default (เช่น Tier 100 หน้า หรือ 500 หน้า)
                    const defaultMaster = await pbAdmin.collection('Total_Quota').getFirstListItem('');

                    // ข. ทำการสร้าง Record ใหม่ในคอลเลกชัน "Quota" (ตารางลูก)
                    const newQuota = await pbAdmin.collection('Quota').create({
                        user: [userId],
                        Total_Quota: [defaultMaster.id],
                        Add_Quota: 0,
                        Use: 0
                    }, { expand: 'Total_Quota' });

                    // จัดการโครงสร้างอ็อบเจกต์ให้ตรงกับ session/locals
                    quotaRecord = {
                        id: newQuota.id,
                        user: userId,
                        expand: {
                            Total_Quota: {
                                id: defaultMaster.id,
                                Total_Quota: defaultMaster.Total_Quota
                            }
                        },
                        Use: 0
                    };

                    console.log(`[Hooks] Auto-created initial Quota record for user: ${userId} linking to Master Quota Tier: ${defaultMaster.id}`);
                } catch (createErr) {
                    console.error('Failed to auto-create quota entry on login:', createErr);
                }
            }

            // 3. แนบสถานะโควต้าที่ใช้งานได้จริงเข้าไปใน session ของผู้ใช้
            event.locals.user = {
                id: full.id,
                email: resolveEmail(full),
                name: full.name ?? full.username,
                username: full.username,
                role: resolveRole(full),
                user_type_id: full.user_type ?? null,
                token: pb.authStore.token,

                quota: {
                    id: quotaRecord?.id ?? null,
                    total: (quotaRecord?.expand?.Total_Quota?.Total_Quota ?? 0) + (quotaRecord?.Add_Quota ?? 0), // สิทธิ์ทั้งหมด (สิทธิ์หลัก + โบนัส)
                    used: quotaRecord?.Use ?? 0           // จำนวนหน้าใช้ไปล่าสุด (เช่น 0)
                }
            };
        } catch {
            pb.authStore.clear();
            event.locals.user = null;
        }
    } else {
        event.locals.user = null;
    }

    return resolve(event);
};