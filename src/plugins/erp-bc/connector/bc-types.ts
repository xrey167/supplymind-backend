export interface BcEntity {
  id: string;
  '@odata.etag'?: string;
  lastModifiedDateTime?: string;
}

export interface PurchaseOrder extends BcEntity {
  number: string;
  vendorId: string;
  vendorNumber: string;
  orderDate: string;
  status: string;
  totalAmountIncludingTax: number;
  currencyCode: string;
}

export interface Vendor extends BcEntity {
  number: string;
  displayName: string;
  email: string | null;
  currencyCode: string;
  blocked: string;
}

export interface GLEntry extends BcEntity {
  entryNumber: number;
  accountNumber: string;
  postingDate: string;
  description: string;
  amount: number;
  debitAmount: number;
  creditAmount: number;
}

export interface Item extends BcEntity {
  number: string;
  displayName: string;
  type: string;
  unitPrice: number;
  unitCost: number;
}

export interface Customer extends BcEntity {
  number: string;
  displayName: string;
  email: string | null;
  balance: number;
  currencyCode: string;
}

export type BcEntityType = 'purchaseOrders' | 'vendors' | 'glEntries' | 'items' | 'customers';

export type BcEntityMap = {
  purchaseOrders: PurchaseOrder;
  vendors: Vendor;
  glEntries: GLEntry;
  items: Item;
  customers: Customer;
};

/** System-assigned fields that must never be written back in a PATCH body (IDs, auto-numbers, read-only timestamps). */
export const SYSTEM_FIELDS: Record<BcEntityType, ReadonlySet<string>> = {
  purchaseOrders: new Set(['id', '@odata.etag', 'lastModifiedDateTime', 'number', 'status']),
  vendors:        new Set(['id', '@odata.etag', 'lastModifiedDateTime', 'number']),
  glEntries:      new Set(['id', '@odata.etag', 'lastModifiedDateTime', 'entryNumber']),
  items:          new Set(['id', '@odata.etag', 'lastModifiedDateTime', 'number']),
  customers:      new Set(['id', '@odata.etag', 'lastModifiedDateTime', 'number']),
};

export interface BcConnectionConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  companyId: string;
}

export interface ODataResponse<T> {
  value: T[];
  '@odata.nextLink'?: string;
  '@odata.context'?: string;
}
