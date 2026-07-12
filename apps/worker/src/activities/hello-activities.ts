export async function pingHealthActivity(): Promise<string> {
  return new Date().toISOString();
}
