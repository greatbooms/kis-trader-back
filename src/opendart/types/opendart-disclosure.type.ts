export interface OpenDartDisclosureItem {
  rcept_dt?: string;
  report_nm?: string;
  corp_cls?: string;
  corp_code?: string;
  corp_name?: string;
  rcept_no?: string;
}

export interface OpenDartOwnershipItem {
  rcept_dt?: string;
  repror?: string;
  sp_stock_lmp_rate?: string | number;
  sp_stock_lmp_irds_rate?: string | number;
}

export interface OpenDartDomesticSignals {
  recentDisclosureCount30d?: number;
  recentPeriodicDisclosureCount30d?: number;
  recentMaterialDisclosureCount30d?: number;
  lastDisclosureDate?: string;
  lastDisclosureTitle?: string;
  insiderOwnershipRate?: number;
  insiderOwnershipChangeRate?: number;
  latestOwnershipReportDate?: string;
}
