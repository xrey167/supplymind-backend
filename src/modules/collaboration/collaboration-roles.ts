/**
 * Supply chain collaboration role — re-export shim.
 *
 * The authoritative definition of SC roles and permission layer now lives in
 * src/plugins/supply-chain/roles.ts. This file re-exports from there for
 * backward compatibility.
 */

export {
  supplyChainRoleLayer,
  SUPPLY_CHAIN_ROLE_ENTRIES,
  registerSupplyChainRoleLayer,
} from '../../plugins/supply-chain/roles';
