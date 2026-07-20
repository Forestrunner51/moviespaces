export const THEATER_MEMBERSHIPS = [
  { key: "amc_stubs", label: "AMC Stubs", chain: "AMC" },
  { key: "amc_alist", label: "AMC A-List", chain: "AMC" },
  { key: "regal_crown", label: "Regal Crown Club", chain: "Regal" },
  { key: "regal_unlimited", label: "Regal Unlimited", chain: "Regal" },
  { key: "cinemark_rewards", label: "Cinemark Movie Rewards", chain: "Cinemark" },
  { key: "cinemark_movie_club", label: "Cinemark Movie Club", chain: "Cinemark" },
] as const;

export const membershipLabel = (key: string) =>
  THEATER_MEMBERSHIPS.find((m) => m.key === key)?.label ?? key;

// Known theater chains for the Explore "Theater Chain" filter — matched
// against a Space's free-text cinemaName since that's all we store.
export const THEATER_CHAINS = ["AMC", "Cinemark", "Regal", "Alamo Drafthouse", "Marcus"] as const;

export const cinemaChain = (cinemaName: string): string | null =>
  THEATER_CHAINS.find((chain) => cinemaName.toLowerCase().includes(chain.toLowerCase())) ?? null;
