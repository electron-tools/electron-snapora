/** Compatibility exports for the Windows API; both platforms share the policy. */
export {
  filterSnapRegions as filterWindowsSnapRegions,
  type SnapCandidate as WindowsSnapCandidate,
  type SnapGranularity as WindowsSnapGranularity,
} from './snap-policy.js';
