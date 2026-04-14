import { z } from 'zod'

export const slugSchema = z.string().min(1).regex(/^[a-z0-9_-]+$/i, 'Must be letters, numbers, hyphen or underscore')
