import { mobileDb, mobileHeaders, mobileJson, mobileUser } from '../_shared/mobile-access.ts';
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: mobileHeaders });
  if (req.method !== 'POST') return mobileJson({ error: 'Method not allowed' }, 405);
  const user = await mobileUser(req);
  if (!user) return mobileJson({ error: 'Sign in to delete your account.' }, 401);
  const db = mobileDb();
  try {
    const { data: files, error: listError } = await db.storage.from('profile-photos').list(user.id);
    if (listError) throw listError;
    if (files?.length) {
      const { error } = await db.storage.from('profile-photos').remove(files.map(file => `${user.id}/${file.name}`));
      if (error) throw error;
    }
    const { error } = await db.auth.admin.deleteUser(user.id);
    if (error) throw error;
    return mobileJson({ deleted: true });
  } catch {
    return mobileJson({ error: 'Could not delete your account. Please retry or contact privacy@echoocity.com.' }, 503);
  }
});
