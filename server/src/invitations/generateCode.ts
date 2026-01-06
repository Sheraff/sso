import { readFileSync } from 'node:fs'

const CODE_LENGTH = 22

export function generateCode(existingCodes: string[]) {
	const WORDS = readFileSync(new URL('./5-6-letter-words.txt', import.meta.url), 'utf-8').split("\n")
	const count = WORDS.length
	while (true) {
		const words = new Array<string>()
		let length = 0
		while (length < CODE_LENGTH) {
			const index = Math.floor(Math.random() * count)
			const word = WORDS[index]
			words.push(word)
			if (length > 0) length++ // space
			length += word.length
		}
		const code = words.join(' ')
		if (existingCodes.includes(code)) continue
		return code
	}
}