import { readFileSync } from 'node:fs'

const CODE_LENGTH = 3

export function generateCode(existingCodes: string[]) {
	const WORDS = readFileSync(new URL('./5-letter-words.txt', import.meta.url), 'utf-8').split("\n")
	const count = WORDS.length
	while (true) {
		const indices: number[] = []
		while (indices.length < CODE_LENGTH) {
			const index = Math.floor(Math.random() * count)
			if (indices.includes(index)) continue
			indices.push(index)
		}
		const code = indices.map((i) => WORDS[i]).join(" ")
		if (existingCodes.includes(code)) continue
		return code
	}
}