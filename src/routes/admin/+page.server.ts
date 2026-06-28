import { error, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { PrintJobsRecord, UsersRecord } from '$lib/server/pocketbase';
import { adjustRemaining, listAllQuotas, resetToDefault } from '$lib/server/quota';
import { clearSession } from '$lib/server/session';

/**
 * ปรับลำดับคิวพิมพ์ในระบบ
 */
function decorateQueuePositions(
    jobs: PrintJobsRecord[]
): Array<PrintJobsRecord & { queuePosition: number | null }> {
    const active = jobs
        .filter((j) => j.status === 'processing' || j.status === 'pending')
        .sort((a, b) => a.created.localeCompare(b.created));

    const positionById = new Map<string, number>();
    active.forEach((job, idx) => positionById.set(job.id, idx + 1));

    return jobs.map((j) => ({
        ...j,
        queuePosition: positionById.get(j.id) ?? null
    }));
}

export const load: PageServerLoad = async ({ locals }) => {
    // 🛡️ ป้องกันความปลอดภัย: เช็คว่าล็อกอินและเป็นแอดมินของระบบจริงไหม
    if (!locals.user) throw redirect(303, '/login');
    if (locals.user.role !== 'admin') throw redirect(303, '/user');

    // ⚡ ดึง pb client ประจำ Request ตัวเองมาใช้เลย (สิทธิ์ Admin ตาราง users ทำงานได้ทันทีผ่าน API Rules)
    const pb = locals.pb;

    const [users, jobsResult, quotasByUser] = await Promise.all([
        pb.collection('users').getFullList<UsersRecord>({
            sort: 'name',
            expand: 'user_type'
        }),
        pb.collection('print_jobs').getList<PrintJobsRecord>(1, 100, {
            sort: '-created',
            expand: 'user'
        }),
        listAllQuotas(pb)
    ]);

    const usersWithQuota = users.map((u) => {
        const q = quotasByUser.get(u.id);
        return {
            ...u,
            quota: q ?? { userId: u.id, remaining: 0, total: 0, used: 0, tierTotal: 0 }
        };
    });

    return {
        users: usersWithQuota,
        jobs: decorateQueuePositions(jobsResult.items)
    };
};

export const actions: Actions = {
    adjustQuota: async ({ request, locals }) => {
        if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');

        const data = await request.formData();
        const userId = String(data.get('userId') ?? '');
        const delta = Number(data.get('delta') ?? 0);

        if (!userId || !Number.isFinite(delta) || delta === 0) {
            return { ok: false, message: 'ข้อมูลไม่ถูกต้อง' };
        }

        const pb = locals.pb; // ⚡ เปลี่ยนมาใช้สิทธิ์ผ่านบัญชีแอดมินปัจจุบัน

try {
            const snapshot = await adjustRemaining(pb, userId, delta);
            
            // ❌ ลบบรรทัดนี้ออกเพื่อเลี่ยงกฎ View Rule
            // const user = await pb.collection('users').getOne<UsersRecord>(userId); 
            
            return {
                ok: true,
                // เปลี่ยนไปแสดงผลด้วยรหัสผู้ใช้ (userId) แทนชื่อ
                message: `ปรับโควต้าให้พนักงานรหัส ${userId} เรียบร้อยแล้ว (เหลือ ${snapshot.remaining}/${snapshot.total} หน้า)`
            };
        } catch (e) {
            console.error('[admin/adjustQuota] failed:', e);
            return { ok: false, message: 'ไม่สามารถอัปเดตโควต้าได้' };
        }
    },

resetQuota: async ({ request, locals }) => {
        if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');

        const data = await request.formData();
        const userId = String(data.get('userId') ?? '');
        
        // ⚡ รับชื่อมาจากหน้าบ้าน (ถ้าไม่มีให้ fallback เป็นรหัส)
        const userName = String(data.get('userName') ?? userId); 
        
        if (!userId) return { ok: false, message: 'ข้อมูลไม่ถูกต้อง' };

        const pb = locals.pb;

        try {
            const snapshot = await resetToDefault(pb, userId);
            
            return {
                ok: true,
                // ⚡ เอา userName มาใส่ตรงนี้ได้เลย!
                message: `รีเซ็ตโควต้าให้ ${userName} เป็น ${snapshot.total} หน้าเรียบร้อยแล้ว`
            };
        } catch (e) {
            console.error('[admin/resetQuota] failed:', e);
            return { ok: false, message: 'ไม่สามารถรีเซ็ตโควต้าได้' };
        }
    },

    bulkAdjustQuota: async ({ request, locals }) => {
        if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');

        const data = await request.formData();
        const userIds = data.getAll('userIds').map((v) => String(v)).filter(Boolean);
        const delta = Number(data.get('delta') ?? 0);

        if (userIds.length === 0) return { ok: false, message: 'ยังไม่ได้เลือกผู้ใช้' };
        if (!Number.isFinite(delta) || delta === 0) return { ok: false, message: 'จำนวนหน้าไม่ถูกต้อง' };

        const pb = locals.pb;

        const settled = await Promise.allSettled(
            userIds.map((userId) => adjustRemaining(pb, userId, delta))
        );

        const ok = settled.filter((r) => r.status === 'fulfilled').length;
        const failed = settled.length - ok;

        return failed === 0 
            ? { ok: true, message: `เพิ่มโควต้า ${delta >= 0 ? '+' : ''}${delta} หน้า ให้ ${ok} คนเรียบร้อย` }
            : { ok: false, message: `ปรับสำเร็จ ${ok} คน, ล้มเหลว ${failed} คน` };
    },

    bulkResetQuota: async ({ request, locals }) => {
        if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');

        const data = await request.formData();
        const userIds = data.getAll('userIds').map((v) => String(v)).filter(Boolean);

        if (userIds.length === 0) return { ok: false, message: 'ยังไม่ได้เลือกผู้ใช้' };

        const pb = locals.pb;

        const settled = await Promise.allSettled(
            userIds.map((userId) => resetToDefault(pb, userId))
        );

        const ok = settled.filter((r) => r.status === 'fulfilled').length;
        const failed = settled.length - ok;

        return failed === 0
            ? { ok: true, message: `รีเซ็ตโควต้าให้ ${ok} คนเรียบร้อย` }
            : { ok: false, message: `รีเซ็ตสำเร็จ ${ok} คน, ล้มเหลว ${failed} คน` };
    },

    suspend: async ({ request, locals }) => {
        if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');

        const data = await request.formData();
        const jobId = String(data.get('jobId') ?? '');
        if (!jobId) return { ok: false, message: 'ข้อมูลไม่ถูกต้อง' };

        try {
            await locals.pb.collection('print_jobs').update(jobId, {
                status: 'failed',
                error_message: 'Suspended by admin'
            });
            return { ok: true, message: 'ระงับงานเรียบร้อย' };
        } catch (e) {
            console.error('[admin/suspend] failed:', e);
            return { ok: false, message: 'ไม่สามารถระงับงานได้' };
        }
    },

    remove: async ({ request, locals }) => {
        if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');

        const data = await request.formData();
        const jobId = String(data.get('jobId') ?? '');
        if (!jobId) return { ok: false, message: 'ข้อมูลไม่ถูกต้อง' };

        try {
            await locals.pb.collection('print_jobs').delete(jobId);
            return { ok: true, message: 'ลบงานออกจากคิวเรียบร้อย' };
        } catch (e) {
            console.error('[admin/remove] failed:', e);
            return { ok: false, message: 'ไม่สามารถลบงานได้' };
        }
    },

    logout: async ({ cookies }) => {
        clearSession(cookies);
        throw redirect(303, '/login');
    }
};