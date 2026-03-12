import { tool } from 'langchain'
import { z } from 'zod'

export default tool((input) => `${input.firstName} ${input.lastName}`, {
  name: 'test',
  description: 'Change it, this only example',
  schema: z.object({
    firstName: z.string().describe('First name to be concated'),
    lastName:  z.string().describe('Last name to be concated')
  }),
})
