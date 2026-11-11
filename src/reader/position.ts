/** Repeated paragraphs are disambiguated by their previous position within the matched section. */
export const closestAnchorBlock = (blocks: string[], text: string, previousIndex: number, start: number, end: number) => {
  if (!text) return -1
  let best = -1
  let distance = Infinity
  for (let index = start; index < end; index++) {
    const candidateDistance = Math.abs(index - previousIndex)
    if (blocks[index] === text && candidateDistance < distance) {
      best = index
      distance = candidateDistance
    }
  }
  return best
}
