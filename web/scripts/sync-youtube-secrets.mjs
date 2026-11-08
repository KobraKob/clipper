import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const tokenPath = path.join(rootDir, "credentials", "youtube_token.json");

if (!fs.existsSync(tokenPath)) {
  console.error("No credentials/youtube_token.json found. Complete YouTube authorization in Chop Shop first.");
  process.exit(1);
}

const tokenData = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
const clientId = tokenData.client_id;
const clientSecret = tokenData.client_secret;
const refreshToken = tokenData.refresh_token;

if (!clientId || !clientSecret || !refreshToken) {
  console.error("youtube_token.json is missing required fields (client_id, client_secret, refresh_token).");
  process.exit(1);
}

console.log("=================================================================");
console.log("  CHOP SHOP YOUTUBE CLOUD SECRETS");
console.log("=================================================================\n");
console.log("Testing YouTube refresh token with Google OAuth...");

try {
  const testRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const testData = await testRes.json();
  if (testRes.ok && testData.access_token) {
    const hours = Math.round((testData.refresh_token_expires_in || 0) / 3600);
    console.log(`[OK] Local refresh token is 100% VALID! (Expires in ~${hours} hours / ${(hours / 24).toFixed(1)} days)\n`);
  } else {
    console.warn("[WARN] Refresh token test returned:", testData);
  }
} catch (err) {
  console.warn("Could not test token with Google:", err.message);
}

console.log("To fix 'Token has been expired or revoked' in Supabase Cloud:\n");
console.log("Option 1: Supabase Web Dashboard (Instant)");
console.log("1. Open: https://supabase.com/dashboard/project/mhqcisqhiovhqalyhtkb/settings/functions");
console.log("2. Under 'Secrets', set the following three variables:\n");
console.log(`YOUTUBE_CLIENT_ID = ${clientId}`);
console.log(`YOUTUBE_CLIENT_SECRET = ${clientSecret}`);
console.log(`YOUTUBE_REFRESH_TOKEN = ${refreshToken}\n`);

console.log("Option 2: Supabase CLI");
console.log("Run the following command in terminal (after 'npx supabase login'):\n");
console.log(
  `npx supabase secrets set --project-ref mhqcisqhiovhqalyhtkb ` +
  `YOUTUBE_CLIENT_ID="${clientId}" ` +
  `YOUTUBE_CLIENT_SECRET="${clientSecret}" ` +
  `YOUTUBE_REFRESH_TOKEN="${refreshToken}"\n`
);
console.log("=================================================================");
