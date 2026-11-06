// 本番の保存先。ふたりのデータと写真を Supabase に置き、権限はデータベース側の RLS で守る。
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm';

const BUCKET = 'photos';
const URL_LIFETIME_SECONDS = 60 * 60;

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

export class SupabaseStore {
  mode = 'supabase';
  #client;
  #session = null;

  constructor({ supabaseUrl, supabaseAnonKey }) {
    this.#client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }

  async init() {}

  async session() {
    const { data } = await this.#client.auth.getSession();
    const authUser = data.session?.user;
    if (!authUser) {
      this.#session = null;
      return null;
    }
    const members = unwrap(await this.#client.from('members').select('user_id, display_name'));
    const me = members.find((member) => member.user_id === authUser.id);
    if (!me) {
      await this.signOut();
      throw new Error('このアカウントはふたりの日のメンバーに登録されていません');
    }
    const other = members.find((member) => member.user_id !== authUser.id);
    this.#session = {
      user: { id: me.user_id, name: me.display_name },
      partner: other ? { id: other.user_id, name: other.display_name } : { id: null, name: '相手' },
    };
    return this.#session;
  }

  async signIn(email, password) {
    unwrap(await this.#client.auth.signInWithPassword({ email, password }));
  }

  async signOut() {
    await this.#client.auth.signOut();
    this.#session = null;
  }

  async changePassword(password) {
    unwrap(await this.#client.auth.updateUser({ password }));
  }

  async #signedUrls(paths) {
    if (!paths.length) return {};
    const rows = unwrap(await this.#client.storage.from(BUCKET).createSignedUrls(paths, URL_LIFETIME_SECONDS));
    return Object.fromEntries(rows.filter((row) => row.signedUrl).map((row) => [row.path, row.signedUrl]));
  }

  async listEntries() {
    const [entries, flags] = await Promise.all([
      this.#client.from('entries')
        .select('*, places(name, kind), photos!photos_entry_id_fkey(id, thumb_path)')
        .order('date', { ascending: false })
        .then(unwrap),
      this.#client.rpc('comment_flags').then(unwrap),
    ]);
    const coverPath = (entry) => (
      entry.photos.find((photo) => photo.id === entry.cover_photo_id) ?? entry.photos[0]
    )?.thumb_path;
    const urls = await this.#signedUrls(entries.map(coverPath).filter(Boolean));
    const myId = this.#session.user.id;
    return entries.map(({ photos, ...entry }) => {
      const authors = flags.filter((flag) => flag.entry_id === entry.id).map((flag) => flag.author_id);
      const path = coverPath({ ...entry, photos });
      return {
        ...entry,
        photoCount: photos.length,
        coverUrl: path ? urls[path] ?? null : null,
        iWrote: authors.includes(myId),
        partnerWrote: authors.some((author) => author !== myId),
      };
    });
  }

  async getEntry(id) {
    const entry = unwrap(await this.#client.from('entries').select('*').eq('id', id).maybeSingle());
    if (!entry) return null;
    const [photos, places, visibleComments, flags] = await Promise.all([
      this.#client.from('photos').select('*').eq('entry_id', id).order('taken_at', { nullsFirst: false }).then(unwrap),
      this.#client.from('places').select('*').eq('entry_id', id).order('arrived_at', { nullsFirst: false }).then(unwrap),
      this.#client.from('comments').select('*').eq('entry_id', id).then(unwrap),
      this.#client.rpc('comment_flags').then(unwrap),
    ]);
    const urls = await this.#signedUrls(photos.flatMap((photo) => [photo.full_path, photo.thumb_path]));
    const myId = this.#session.user.id;
    return {
      ...entry,
      photos: photos.map((photo) => ({
        ...photo,
        url: urls[photo.full_path],
        thumbUrl: urls[photo.thumb_path],
      })),
      places,
      comments: {
        mine: visibleComments.find((comment) => comment.author_id === myId) ?? null,
        partner: visibleComments.find((comment) => comment.author_id !== myId) ?? null,
        partnerWrote: flags.some((flag) => flag.entry_id === id && flag.author_id !== myId),
      },
    };
  }

  async createEntry({ date, end_date = null, title = '', source = 'manual' }) {
    const existing = unwrap(await this.#client.from('entries').select('*').eq('date', date).maybeSingle());
    if (existing) return existing;
    return unwrap(await this.#client.from('entries')
      .insert({ date, end_date, title, source, created_by: this.#session.user.id })
      .select()
      .single());
  }

  async updateEntry(id, patch) {
    unwrap(await this.#client.from('entries').update(patch).eq('id', id));
  }

  async deleteEntry(id) {
    const photos = unwrap(await this.#client.from('photos').select('full_path, thumb_path').eq('entry_id', id));
    const paths = photos.flatMap((photo) => [photo.full_path, photo.thumb_path]);
    if (paths.length) unwrap(await this.#client.storage.from(BUCKET).remove(paths));
    unwrap(await this.#client.from('entries').delete().eq('id', id));
  }

  async addPhotos(entryId, items, onProgress = () => {}) {
    let finished = 0;
    for (const item of items) {
      const stem = `${entryId}/${crypto.randomUUID()}`;
      const fullPath = `${stem}.jpg`;
      const thumbPath = `${stem}-thumb.jpg`;
      const storage = this.#client.storage.from(BUCKET);
      unwrap(await storage.upload(fullPath, item.full, { contentType: 'image/jpeg' }));
      unwrap(await storage.upload(thumbPath, item.thumb, { contentType: 'image/jpeg' }));
      unwrap(await this.#client.from('photos').insert({
        entry_id: entryId,
        full_path: fullPath,
        thumb_path: thumbPath,
        category: item.category,
        score: item.score,
        taken_at: item.taken_at,
        dominant: item.dominant,
        width: item.width,
        height: item.height,
        uploaded_by: this.#session.user.id,
      }));
      finished += 1;
      onProgress(finished, items.length);
    }
  }

  async deletePhoto(photo) {
    unwrap(await this.#client.storage.from(BUCKET).remove([photo.full_path, photo.thumb_path]));
    unwrap(await this.#client.from('photos').delete().eq('id', photo.id));
  }

  async addPlaces(entryId, places) {
    if (!places.length) return;
    unwrap(await this.#client.from('places').insert(places.map((place) => ({ entry_id: entryId, ...place }))));
  }

  async updatePlace(id, patch) {
    unwrap(await this.#client.from('places').update(patch).eq('id', id));
  }

  async deletePlace(id) {
    unwrap(await this.#client.from('places').delete().eq('id', id));
  }

  async saveComment(entryId, body) {
    unwrap(await this.#client.from('comments').upsert(
      { entry_id: entryId, author_id: this.#session.user.id, body },
      { onConflict: 'entry_id,author_id' },
    ));
  }
}
