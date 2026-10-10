import { modelText, type Sense, type Settings } from "./core";
import { generate, generateImage } from "./providers";
import { bucket, getSense, publicSense, updateMaterials } from "./store";

// Collapse duplicate clicks from multiple tabs within this local server.
const pending = new Map<string, Promise<{ sense: Sense }>>();
export async function illustrate(userId: string, sense: Sense, materialId: string, config: Settings): Promise<{ sense: Sense }> {
  const key = JSON.stringify([userId, sense.id, materialId]);
  const active = pending.get(key);
  if (active) return active;
  const work = (async () => {
    const current = publicSense(await getSense(userId, sense.id));
    const item = current.materials.find(material => material.id === materialId)!;
    const storage = bucket();
    if (item.scene?.objectKey && item.scene.imageUrl && await storage.head(item.scene.objectKey)) return { sense: current };
    const result = await generate(config,
      'Return {"title":"short Chinese scene title","description":"short Chinese scene caption","prompt":"English visual prompt, at most 1100 characters"}. Depict a concrete everyday scene that clearly illustrates the supplied English text in context. For synonym or antonym examples, depict the example itself and its related term, not the opposite target meaning. Choose a clear educational illustration with recognizable actions and objects. No text, letters, labels, subtitles, logos or watermarks in the picture.',
      { word: sense.word, meaning: sense.meaning, definition: sense.definition, kind: item.kind, relatedTerm: item.term, text: item.text });
    const title = modelText(result.title, 100), description = modelText(result.description, 500);
    const image = await generateImage(modelText(result.prompt, 1100) + " Clear educational illustration. No text, letters, captions, logos or watermarks.");
    const objectKey = "images/" + crypto.randomUUID();
    await storage.put(objectKey, image.bytes, { httpMetadata: { contentType: image.mimeType }, customMetadata: { word: sense.word } });
    const scene = { title, description, objectKey, mimeType: image.mimeType, model: image.model,
      imageUrl: "/api/image?senseId=" + encodeURIComponent(sense.id) + "&materialId=" + encodeURIComponent(item.id) };
    try {
      return { sense: await updateMaterials(userId, sense.id, latest => latest.materials.map(existing => existing.id === item.id ? { ...existing, scene } : existing)) };
    } catch (error) { await storage.delete(objectKey).catch(() => {}); throw error; }
  })();
  pending.set(key, work);
  try { return await work; } finally { pending.delete(key); }
}
