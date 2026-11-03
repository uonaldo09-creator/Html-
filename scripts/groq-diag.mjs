// Groq key diagnostic — never prints the secret, only safe metadata + the API's own error.
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const key = process.env.GROQ_API_KEY;
const present = key !== undefined && key !== null;
const safe = key ? key.trim() : "";

console.log("present        :", present);
if (present) {
  console.log("trimmed length :", safe.length);
  console.log("prefix         :", safe.slice(0, 4) + "…" + (safe.length > 4 ? safe.slice(-2) : ""));
  console.log("looks like key :", /^gsk_[A-Za-z0-9]{10,}$/.test(safe));
  console.log("placeholder?   :", safe === "" || safe === "MY_GROQ_API_KEY" || safe.startsWith("YOUR_") || safe.startsWith("MY_") || safe.includes("INSERT_") || safe.includes("API_KEY_HERE"));
}

if (!present || !safe) {
  console.log("\nRESULT: GROQ_API_KEY is missing or empty in .env");
  process.exit(0);
}
if (safe === "MY_GROQ_API_KEY" || safe.includes("INSERT_") || safe.startsWith("YOUR_")) {
  console.log("\nRESULT: GROQ_API_KEY is still the placeholder — no real key in .env");
  process.exit(0);
}

// Live probe of the actual API with the real key (error bodies are safe to print; keys are not echoed by Groq).
const res = await fetch("https://api.groq.com/openai/v1/models", {
  headers: { Authorization: `Bearer ${safe}` },
});
console.log("http status    :", res.status);
const body = await res.text();
console.log("api response   :", body.slice(0, 500));
console.log("\nRESULT:", res.ok ? "KEY WORKS" : "KEY REJECTED BY GROQ");
