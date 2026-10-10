import { authenticated, body, failure, json } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/store";
import { action } from "@/lib/server/service";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const user = await authenticated();
    const payload = await body(request);
    await rateLimit(user.userId);
    return json(await action(user.userId, payload));
  } catch (error) { return failure(error); }
}
