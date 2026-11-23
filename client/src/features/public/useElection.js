// M3 — current election (status, times) from GET /api/elections/current.
import { useFetch } from '../../components/ui/useFetch.js';

export function useElection() {
  return useFetch('/elections/current');
}

export default useElection;
