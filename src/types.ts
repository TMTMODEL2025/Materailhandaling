export interface SheetTabConfig {
  gid: string;
  name: string;
  category: string;
  description: string;
  reverseOrder?: boolean;
  defaultLimit?: number;
}

export interface SheetColumn {
  id: string;
  label: string;
  type: string;
}

export interface SheetRow {
  rowNumber: number;
  values: Record<string, string>;
  rawValues: Record<string, string | number | null>;
}

export interface SheetDataResult {
  sheetId: string;
  gid: string;
  tabName: string;
  columns: SheetColumn[];
  rows: SheetRow[];
  totalRowsInSheet: number;
  fetchedAt: string;
}

export interface JobTransferPayload {
  date: string;
  employeeId: string;
  driverName: string;
  vehicleNumber: string;
  trailerNumber: string;
  productType: string;
  weight: number;
  origin: string;
  startTime: string;
  destination: string;
  endTime: string;
  duration: string;
  status: string;
  note: string;
  rounds: number;
}

export interface DeliveryPointPayload {
  date: string;
  deliveryPoint: string;
  gate: string;
}


