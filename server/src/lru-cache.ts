export type LRUCache<TKey, TValue> = {
	get: (key: TKey, cb: (err: any, value?: TValue) => void) => void
	set: (key: TKey, value: TValue, cb: (err?: any) => void) => void
	destroy: (key: TKey, cb: (err?: any) => void) => void
	clear: (cb: (err?: any) => void) => void
}

export function createLRUCache<TKey, TValue>(
	max: number,
): LRUCache<TKey, TValue> {
	type Node = { prev?: Node; next?: Node; key: TKey; value: TValue }
	const cache = new Map<TKey, Node>()
	let oldest: Node | undefined
	let newest: Node | undefined

	const touch = (entry: Node) => {
		if (!entry.next) return
		if (!entry.prev) {
			entry.next.prev = undefined
			oldest = entry.next
			entry.next = undefined
			if (newest) {
				entry.prev = newest
				newest.next = entry
			}
		} else {
			entry.prev.next = entry.next
			entry.next.prev = entry.prev
			entry.next = undefined
			if (newest) {
				newest.next = entry
				entry.prev = newest
			}
		}
		newest = entry
	}

	return {
		get(key, cb) {
			const entry = cache.get(key)
			if (!entry) return cb(null, entry)
			touch(entry)
			cb(null, entry.value)
		},
		set(key, value, cb) {
			if (cache.size >= max && oldest) {
				const toDelete = oldest
				cache.delete(toDelete.key)
				if (toDelete.next) {
					oldest = toDelete.next
					toDelete.next.prev = undefined
				}
				if (toDelete === newest) {
					newest = undefined
				}
			}
			const existing = cache.get(key)
			if (existing) {
				existing.value = value
				touch(existing)
			} else {
				const entry: Node = { key, value, prev: newest }
				if (newest) newest.next = entry
				newest = entry
				if (!oldest) oldest = entry
				cache.set(key, entry)
			}
			console.log(`LRU Cache Size: ${cache.size}`)
			console.log(`new key: ${key}`)
			console.log(value)
			cb()
		},
		destroy(key, cb) {
			const entry = cache.get(key)
			if (!entry) return cb()
			if (entry.prev) {
				entry.prev.next = entry.next
			} else {
				oldest = entry.next
			}
			if (entry.next) {
				entry.next.prev = entry.prev
			} else {
				newest = entry.prev
			}
			cache.delete(key)
			cb()
		},
		clear(cb) {
			cache.clear()
			oldest = undefined
			newest = undefined
			cb()
		},
	}
}
