const ORIIGN = process.env.ORIGIN!
if (!ORIIGN) throw new Error("ORIGIN not set in environment")

const hostname = new URL(ORIIGN).hostname

export const domain = hostname === "localhost" ? hostname : hostname.split(".").slice(-2).join(".")