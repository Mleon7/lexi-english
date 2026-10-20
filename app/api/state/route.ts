import { env } from "cloudflare:workers";
import { authenticated, failure, json } from "@/lib/server/http";
import { listSenses, settings } from "@/lib/server/store";
import { speechConfiguration } from "@/lib/server/speech-config";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await authenticated();
    const [senses, config] = await Promise.all([listSenses(user.userId), settings(user.userId)]);
    return json({ senses, settings: config, services: { text: !!env.DEEPSEEK_API_KEY, speech: speechConfiguration().configured }, user: { displayName: user.displayName } });
  } catch (error) { return failure(error); }
}
