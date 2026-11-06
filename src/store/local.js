// デモモードの保存先。この端末の IndexedDB だけに保存し、視点を切り替えてふたり分を試せる。
const USERS = {
  me: { id: 'me', name: '自分' },
  partner: { id: 'partner', name: '相手' },
};

const DB_NAME = 'futari-demo';
const STORES = ['entries', 'photos', 'places', 'comments', 'kv'];

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of STORES) request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class LocalStore {
  mode = 'demo';
  #db = null;
  #viewer = 'me';
  #urls = new Map();

  async init() {
    this.#db = await openDb();
    const viewer = await this.#get('kv', 'viewer');
    if (viewer) this.#viewer = viewer.value;
    const seeded = await this.#get('kv', 'seeded');
    if (!seeded) {
      await this.#put('kv', { id: 'seeded', value: true });
      const { seedDemo } = await import('./seed.js');
      await seedDemo(this);
    }
  }

  #store(name, mode = 'readonly') {
    return this.#db.transaction(name, mode).objectStore(name);
  }
  #get(name, id) { return done(this.#store(name).get(id)); }
  #all(name) { return done(this.#store(name).getAll()); }
  #put(name, value) { return done(this.#store(name, 'readwrite').put(value)); }
  #delete(name, id) { return done(this.#store(name, 'readwrite').delete(id)); }

  #url(key, blob) {
    if (!this.#urls.has(key)) this.#urls.set(key, URL.createObjectURL(blob));
    return this.#urls.get(key);
  }

  #photoView(photo) {
    const { full, thumb, ...rest } = photo;
    return {
      ...rest,
      url: this.#url(`${photo.id}:full`, full),
      thumbUrl: this.#url(`${photo.id}:thumb`, thumb),
    };
  }

  async session() {
    const me = USERS[this.#viewer];
    const partner = USERS[this.#viewer === 'me' ? 'partner' : 'me'];
    return { user: me, partner };
  }

  async switchViewer() {
    this.#viewer = this.#viewer === 'me' ? 'partner' : 'me';
    await this.#put('kv', { id: 'viewer', value: this.#viewer });
  }

  async seedAs(viewer, action) {
    const previous = this.#viewer;
    this.#viewer = viewer;
    try {
      return await action();
    } finally {
      this.#viewer = previous;
    }
  }

  async reset() {
    this.#db.close();
    await done(indexedDB.deleteDatabase(DB_NAME));
  }

  async listEntries() {
    const [entries, photos, places, comments] = await Promise.all([
      this.#all('entries'), this.#all('photos'), this.#all('places'), this.#all('comments'),
    ]);
    return entries
      .map((entry) => {
        const own = photos.filter((photo) => photo.entry_id === entry.id);
        const cover = own.find((photo) => photo.id === entry.cover_photo_id) ?? own[0];
        const notes = comments.filter((comment) => comment.entry_id === entry.id);
        return {
          ...entry,
          places: places.filter((place) => place.entry_id === entry.id),
          photoCount: own.length,
          coverUrl: cover ? this.#url(`${cover.id}:thumb`, cover.thumb) : null,
          iWrote: notes.some((note) => note.author_id === this.#viewer),
          partnerWrote: notes.some((note) => note.author_id !== this.#viewer),
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  async getEntry(id) {
    const entry = await this.#get('entries', id);
    if (!entry) return null;
    const [photos, places, comments] = await Promise.all([
      this.#all('photos'), this.#all('places'), this.#all('comments'),
    ]);
    const notes = comments.filter((comment) => comment.entry_id === id);
    const mine = notes.find((note) => note.author_id === this.#viewer) ?? null;
    const other = notes.find((note) => note.author_id !== this.#viewer) ?? null;
    return {
      ...entry,
      photos: photos
        .filter((photo) => photo.entry_id === id)
        .sort((a, b) => (a.taken_at ?? '').localeCompare(b.taken_at ?? ''))
        .map((photo) => this.#photoView(photo)),
      places: places
        .filter((place) => place.entry_id === id)
        .sort((a, b) => (a.arrived_at ?? '').localeCompare(b.arrived_at ?? '')),
      comments: {
        mine,
        // Supabase 側の RLS と同じく、自分が書くまで本文は渡さない。
        partner: mine ? other : null,
        partnerWrote: Boolean(other),
      },
    };
  }

  async createEntry({ date, end_date = null, title = '', source = 'manual' }) {
    const existing = (await this.#all('entries')).find((entry) => entry.date === date);
    if (existing) return existing;
    const entry = {
      id: crypto.randomUUID(), date, end_date, title, source,
      mood: null, cover_photo_id: null, created_at: new Date().toISOString(),
    };
    await this.#put('entries', entry);
    return entry;
  }

  async updateEntry(id, patch) {
    const entry = await this.#get('entries', id);
    await this.#put('entries', { ...entry, ...patch });
  }

  async deleteEntry(id) {
    const removeWhere = async (name) => {
      const rows = await this.#all(name);
      await Promise.all(rows
        .filter((row) => row.entry_id === id)
        .map((row) => this.#delete(name, row.id)));
    };
    await Promise.all(['photos', 'places', 'comments'].map(removeWhere));
    await this.#delete('entries', id);
  }

  async addPhotos(entryId, items, onProgress = () => {}) {
    let finished = 0;
    for (const item of items) {
      await this.#put('photos', {
        id: crypto.randomUUID(),
        entry_id: entryId,
        full: item.full,
        thumb: item.thumb,
        category: item.category,
        score: item.score,
        taken_at: item.taken_at,
        dominant: item.dominant,
        width: item.width,
        height: item.height,
        uploaded_by: this.#viewer,
        created_at: new Date().toISOString(),
      });
      finished += 1;
      onProgress(finished, items.length);
    }
  }

  async deletePhoto(photo) {
    await this.#delete('photos', photo.id);
    const entry = await this.#get('entries', photo.entry_id);
    if (entry?.cover_photo_id === photo.id) await this.updateEntry(entry.id, { cover_photo_id: null });
  }

  async addPlaces(entryId, places) {
    await Promise.all(places.map((place) => this.#put('places', {
      id: crypto.randomUUID(), entry_id: entryId, ...place, created_at: new Date().toISOString(),
    })));
  }

  async updatePlace(id, patch) {
    const place = await this.#get('places', id);
    await this.#put('places', { ...place, ...patch });
  }

  async deletePlace(id) { await this.#delete('places', id); }

  async saveComment(entryId, body) {
    const comments = await this.#all('comments');
    const existing = comments.find((row) => row.entry_id === entryId && row.author_id === this.#viewer);
    const now = new Date().toISOString();
    await this.#put('comments', existing
      ? { ...existing, body, updated_at: now }
      : { id: crypto.randomUUID(), entry_id: entryId, author_id: this.#viewer, body, created_at: now, updated_at: now });
  }
}
