export interface QuotaSnapshot {
	remaining: number;
	total: number;
	used: number;
}

export interface UserQuotaRow extends QuotaSnapshot {
	userId: string;
	tierTotal: number;
}

export interface TotalQuotaPackage {
	id: string;
	Total_Quota: number;
}

export interface QuotaRow {
	id: string;
	user: string;
	Total_Quota?: string;     // (Relation) ชี้ไปที่ตาราง Total_Quota (แพ็กเกจสิทธิ์หลัก)
	Add_Quota: number;        // (Number) สิทธิ์เสริม/โบนัสรายบุคคล
	Use: number;              // (Number) จำนวนหน้าที่ใช้ไป
	expand?: { Total_Quota?: TotalQuotaPackage };
}
