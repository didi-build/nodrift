import type { Finding, FatalError } from "../findings.js";

export type ColumnOverride = {
  whose?: string;
  data?: string;
  purpose?: string;
  storage?: string;
  processors?: string[];
  retention?: string;
  who_can_see?: string;
  source?: string;
  verified?: boolean;
  notes?: string;
};

export type TableDefaults = ColumnOverride;

export type D1Table = {
  defaults?: TableDefaults;
  columns: Record<string, ColumnOverride>;
};

export type OtherItem = {
  id: string;
  whose: string;
  data: string;
  purpose: string;
  processors: string[];
  retention: string;
  binding?: string | string[];
  storage?: string;
  who_can_see?: string;
  source?: string;
  verified?: boolean;
  notes?: string;
};

export type DataMap = {
  schema_version: number;
  d1_tables: Record<string, D1Table>;
  other_items: OtherItem[];
};

export type ParseDataMapSuccess = {
  map: DataMap;
  findings: Finding[];
};

export type ParseDataMapFatal = {
  fatal: FatalError;
};

export type ParseDataMapResult = ParseDataMapSuccess | ParseDataMapFatal;

export type Sourced<T> = {
  value: T;
  path: string;
};

export type ExpandedD1Column = {
  kind: "d1_column";
  id: string;
  table: string;
  column: string;
  whose: Sourced<string>;
  data?: Sourced<string>;
  purpose?: Sourced<string>;
  storage?: Sourced<string>;
  processors?: Sourced<string[]>;
  retention?: Sourced<string>;
  who_can_see?: Sourced<string>;
  source?: Sourced<string>;
  verified?: Sourced<boolean>;
  notes?: Sourced<string>;
};

export type ExpandedOtherItem = {
  kind: "other_item";
  id: string;
  whose: Sourced<string>;
  data: Sourced<string>;
  purpose: Sourced<string>;
  processors: Sourced<string[]>;
  retention: Sourced<string>;
  binding?: Sourced<string | string[]>;
  storage?: Sourced<string>;
  who_can_see?: Sourced<string>;
  source?: Sourced<string>;
  verified?: Sourced<boolean>;
  notes?: Sourced<string>;
};

export type ExpandedEntry = ExpandedD1Column | ExpandedOtherItem;
