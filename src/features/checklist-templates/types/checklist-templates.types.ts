export type EntryType = 'MATCH' | 'TRAINING'

export type DataType = 'BOOLEAN' | 'NUMBER' | 'TEXT' | 'DATE' | 'SELECT' | 'MULTI_SELECT'

export type SelectSource = 'STATIC' | 'POSITION_METADATA' | 'PLAYER_POSITION' | 'TRAINING_TYPE' | 'SQL'

export type ChecklistTemplateOption = {
    id: string
    valueCode: string
    valueLabel: string
    sortOrder: number
    metadata?: string // JSON string with additional information
}

export type ChecklistTemplateItem = {
    id: string
    label: string
    dataType: DataType
    isRequired: boolean
    sortOrder: number
    selectSource?: SelectSource
    options: ChecklistTemplateOption[]
    // New fields from database migration
    placeholder?: string
    helpText?: string
    validationRules?: Record<string, any> // JSONB
}

export type ChecklistTemplate = {
    id: string
    code: string
    name: string
    entryType: EntryType
    isActive: boolean
    createdAt: string
    items: ChecklistTemplateItem[]
}

export type CreateChecklistTemplatePayload = {
    code: string
    name: string
    entryType: EntryType
    items: Omit<ChecklistTemplateItem, 'id'>[]
}

export type UpdateChecklistTemplatePayload = Partial<{
    name: string
    entryType: EntryType
    isActive: boolean
    items: ChecklistTemplateItem[]
}>
