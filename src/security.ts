/**
 * security.ts — vérification OAuth avec JWKS locale
 */
import fs from "fs";
import { createLocalJWKSet, jwtVerify } from "jose";

//
// 1. Charge la JWKS locale (téléchargée depuis Auth0)
//    -> fichier jwks.json à la racine du projet.
//
const jwksPath = "./jwks.json";
if (!fs.existsSync(jwksPath)) {
  console.error("❌ JWKS introuvable :", jwksPath);
  process.exit(1);
}
const jwks = JSON.parse(fs.readFileSync(jwksPath, "utf8"));
const JWKS = createLocalJWKSet(jwks);

//
// 2. Variables d’environnement (avec valeurs par défaut sûres)
//
const ISSUER =
  process.env.OIDC_ISSUER || "https://dev-hzreygt8mo24tins.us.auth0.com/";
const AUDIENCE = process.env.OIDC_AUDIENCE || "https://mind-protocol";

//
// 3. Middleware / helper de vérification
//
export async function verifyOAuthBearer(req: any) {
  const h = req.get("authorization") || "";
  if (!h.startsWith("Bearer ")) {
    throw Object.assign(new Error("missing bearer"), { status: 401 });
  }

  const token = h.slice(7);

  try {
    await jwtVerify(token, JWKS, { issuer: ISSUER, audience: AUDIENCE });
    // ✅ Token valide
    return true;
  } catch (err: any) {
    console.error("❌ Invalid token:", err);
    throw Object.assign(new Error("invalid token"), { status: 401 });
  }
}
