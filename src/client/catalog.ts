/**
 * Catalog state. Mutated only from server responses (uploaded asset prepended, updated one
 * replaced, deleted one removed), so what the grid shows is always something the server confirmed.
 */

import type { AssetId, AssetView } from "../shared/domain";

export interface AssetsState {
  readonly assets: readonly AssetView[];
  readonly loading: boolean;
  readonly error: string | null;
}

export type AssetsAction =
  | { readonly type: "loaded"; readonly assets: readonly AssetView[] }
  | { readonly type: "failed"; readonly error: string }
  | { readonly type: "uploaded"; readonly asset: AssetView }
  | { readonly type: "updated"; readonly asset: AssetView }
  | { readonly type: "removed"; readonly id: AssetId };

export function initialAssets(assets: readonly AssetView[] | null): AssetsState {
  return assets === null ? { assets: [], loading: true, error: null } : { assets, loading: false, error: null };
}

export function assetsReducer(state: AssetsState, action: AssetsAction): AssetsState {
  switch (action.type) {
    case "loaded":
      return { assets: action.assets, loading: false, error: null };
    case "failed":
      return { ...state, loading: false, error: action.error };
    case "uploaded":
      return { ...state, assets: [action.asset, ...state.assets.filter((a) => a.id !== action.asset.id)] };
    case "updated":
      return { ...state, assets: state.assets.map((a) => (a.id === action.asset.id ? action.asset : a)) };
    case "removed":
      return { ...state, assets: state.assets.filter((a) => a.id !== action.id) };
  }
}
