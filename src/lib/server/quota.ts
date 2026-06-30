import { getAdminClient, type AppPocketBase } from './pocketbase';
import { serverEnv } from './env';

export interface QuotaSnapshot {
    remaining: number;
    total: number;
    used: number;
}

export interface UserQuotaRow extends QuotaSnapshot {
    userId: string;
    tierTotal: number;
}

interface TotalQuotaPackage {
    id: string;
    Total_Quota: number;
}

interface QuotaRow {
    id: string;
    user: string;
    Total_Quota?: string;     // (Relation) ชี้ไปที่ตาราง Total_Quota (แพ็กเกจสิทธิ์หลัก)
    Add_Quota: number;        // (Number) สิทธิ์เสริม/โบนัสรายบุคคล
    Use: number;              // (Number) จำนวนหน้าที่ใช้ไป
    expand?: { Total_Quota?: TotalQuotaPackage };
}

/**
 * ฟังก์ชันช่วยคำนวณโควต้า (ดึงค่าจาก Memory โดยตรง ไม่ต้องยิง DB เพิ่ม)
 * สูตร: (สิทธิ์จากแพ็กเกจหลัก + โบนัสส่วนตัว) - ที่ใช้ไป
 */
function calculateSnapshot(row: QuotaRow): QuotaSnapshot & { tierTotal: number } {
    const tierTotal = row.expand?.Total_Quota?.Total_Quota || 0; // ดึงจากตารางแม่
    const personalBonus = row.Add_Quota || 0;                    // ดึงโบนัสส่วนตัว
    const absoluteTotal = tierTotal + personalBonus;             // รวมโควต้าทั้งหมด
    const used = row.Use || 0;

    return {
        remaining: Math.max(0, absoluteTotal - used),
        total: absoluteTotal,
        used: Math.max(0, used),
        tierTotal
    };
}

/**
 * ดึงข้อมูลแพ็กเกจหลักเริ่มต้น ถ้าไม่มีในระบบให้สร้างใหม่
 */
async function getDefaultPackage(pb: AppPocketBase): Promise<TotalQuotaPackage> {
    const adminPb = await getAdminClient();
    try {
        return await adminPb.collection('Total_Quota').getFirstListItem<TotalQuotaPackage>('');
    } catch {
        return (await adminPb.collection('Total_Quota').create({
            Total_Quota: serverEnv.defaultQuotaPages || 500
        })) as TotalQuotaPackage;
    }
}

/**
 * ค้นหาข้อมูลโควต้าของพนักงาน
 */
export async function getQuota(pb: AppPocketBase, userId: string): Promise<QuotaSnapshot> {
    try {
        const row = await pb.collection('Quota').getFirstListItem<QuotaRow>(`user="${userId}"`, {
            expand: 'Total_Quota' // ขยาย Relation
        });
        return calculateSnapshot(row);
    } catch {
        // ถ้าไม่เคยมีข้อมูล สร้างข้อมูลใหม่ลงในตาราง Quota
        try {
            const adminPb = await getAdminClient();
            const defaultPkg = await getDefaultPackage(pb);
            const newRow = await adminPb.collection('Quota').create<QuotaRow>({
                user: [userId],
                Total_Quota: [defaultPkg.id],
                Add_Quota: 0,
                Use: 0
            }, { expand: 'Total_Quota' });
            return calculateSnapshot(newRow);
        } catch (createErr) {
            console.error('[Quota] Failed to create default quota for user:', userId, createErr);
            throw new Error('ไม่สามารถสร้างสิทธิ์พิมพ์งานได้ กรุณาติดต่อ Bornzi');
        }
    }
}

/**
 * โหลดข้อมูลโควต้าของพนักงานทุกคนพร้อมกัน (เร็วปรู๊ดปร๊าด ไม่มี N+1 Query)
 */
export async function listAllQuotas(pb: AppPocketBase): Promise<Map<string, UserQuotaRow>> {
    const rows = await pb.collection('Quota').getFullList<QuotaRow>({
        expand: 'Total_Quota' // ⚡ ดึงข้อมูลตารางแม่มาพร้อมกันทุกคนใน Request เดียว
    });

    const out = new Map<string, UserQuotaRow>();
    for (const r of rows) {
        if (!r.user) continue;
        const snap = calculateSnapshot(r);
        out.set(r.user, { userId: r.user, ...snap });
    }
    return out;
}

/**
 * หักโควต้าเมื่อสั่งพิมพ์
 */
export async function deductQuota(pb: AppPocketBase, userId: string, pages: number): Promise<QuotaSnapshot | null> {
    if (pages <= 0) return getQuota(pb, userId);

    try {
        let row: QuotaRow;
        try {
            row = await pb.collection('Quota').getFirstListItem<QuotaRow>(`user="${userId}"`, {
                expand: 'Total_Quota'
            });
        } catch {
            // หากไม่มีข้อมูลโควต้าในฐานข้อมูล ให้สร้างขึ้นมาใหม่
            const adminPb = await getAdminClient();
            const defaultPkg = await getDefaultPackage(pb);
            row = await adminPb.collection('Quota').create<QuotaRow>({
                user: [userId],
                Total_Quota: [defaultPkg.id],
                Add_Quota: 0,
                Use: 0
            }, { expand: 'Total_Quota' });
        }

        const snap = calculateSnapshot(row);
        if (snap.remaining < pages) return null; // โควต้าไม่พอ

        // อัปเดตยอดใช้ไป
        const adminPb = await getAdminClient();
        const updatedRow = await adminPb.collection('Quota').update<QuotaRow>(row.id, {
            Use: row.Use + pages
        }, { expand: 'Total_Quota' });

        return calculateSnapshot(updatedRow);
    } catch (err) {
        console.error('[Quota] deductQuota failed:', err);
        return null;
    }
}

/**
 * คืนโควต้า (ลดจำนวน Use)
 */
export async function refundQuota(pb: AppPocketBase, userId: string, pages: number): Promise<QuotaSnapshot> {
    if (pages <= 0) return getQuota(pb, userId);
    try {
        const row = await pb.collection('Quota').getFirstListItem<QuotaRow>(`user="${userId}"`, { expand: 'Total_Quota' });
        const updatedRow = await pb.collection('Quota').update<QuotaRow>(row.id, {
            Use: Math.max(0, row.Use - pages)
        }, { expand: 'Total_Quota' });
        return calculateSnapshot(updatedRow);
    } catch {
        return getQuota(pb, userId);
    }
}

/**
 * Admin: "+ เพิ่มโควต้า" (บวกเลขเพิ่มเข้าไปในสิทธิ์เสริมส่วนตัว)
 */
export async function adjustRemaining(pb: AppPocketBase, userId: string, delta: number): Promise<QuotaSnapshot> {
    if (!Number.isFinite(delta) || delta === 0) return getQuota(pb, userId);

    try {
        const row = await pb.collection('Quota').getFirstListItem<QuotaRow>(`user="${userId}"`, { expand: 'Total_Quota' });

        // อัปเดตตัวเลขเข้าฟิลด์ Add_Quota
        const updatedRow = await pb.collection('Quota').update<QuotaRow>(row.id, {
            Add_Quota: row.Add_Quota + delta
        }, { expand: 'Total_Quota' });

        return calculateSnapshot(updatedRow);
    } catch {
        // ถ้าไม่เคยมีฐานข้อมูลโควต้า สร้างใหม่เลย
        const defaultPkg = await getDefaultPackage(pb);
        const newRow = await pb.collection('Quota').create<QuotaRow>({
            // ⚡ ใส่ก้ามปูครอบให้กลายเป็น Array
            user: [userId],
            Total_Quota: [defaultPkg.id],
            Add_Quota: delta > 0 ? delta : 0,
            Use: 0
        }, { expand: 'Total_Quota' });

        return calculateSnapshot(newRow);
    }
}

/**
 * Admin: "รีเซ็ตโควต้า" (ล้างโบนัสและยอดใช้ กลับไปพึ่งสิทธิ์หลักอย่างเดียว)
 */
export async function resetToDefault(pb: AppPocketBase, userId: string): Promise<QuotaSnapshot> {
    try {
        const row = await pb.collection('Quota').getFirstListItem<QuotaRow>(`user="${userId}"`, { expand: 'Total_Quota' });

        // ล้างยอด Use เป็น 0 และล้างโบนัส Add_Quota ส่วนตัวเป็น 0
        const updatedRow = await pb.collection('Quota').update<QuotaRow>(row.id, {
            Add_Quota: 0,
            Use: 0
        }, { expand: 'Total_Quota' });

        return calculateSnapshot(updatedRow);
    } catch {
        const defaultPkg = await getDefaultPackage(pb);
        const newRow = await pb.collection('Quota').create<QuotaRow>({
            // ⚡ ใส่ก้ามปูครอบเหมือนกัน
            user: [userId],
            Total_Quota: [defaultPkg.id],
            Add_Quota: 0,
            Use: 0
        }, { expand: 'Total_Quota' });

        return calculateSnapshot(newRow);
    }
}