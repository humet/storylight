// Better Auth's catch-all endpoint. The handlers are defined in the auth
// adapter (the only place the provider SDK may be imported, domain rule 12);
// this file is a thin re-export so the boundary lint stays satisfied.
export { GET, POST } from "@/adapters/auth/route";
