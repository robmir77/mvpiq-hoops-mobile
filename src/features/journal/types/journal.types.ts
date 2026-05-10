export type EntryType = 'MATCH' | 'TRAINING'

export type ChecklistTemplateOption = {
    id: string
    valueCode: string
    valueLabel: string
    sortOrder: number
}

export type ChecklistTemplateItemOption = {
    id: string
    valueCode: string
    valueLabel: string
    sortOrder: number
    metadata?: string // JSON string with additional information
}

export type SelectSource = 'STATIC' | 'POSITION_METADATA' | 'PLAYER_POSITION' | 'TRAINING_TYPE' | 'SQL'

export type ChecklistTemplateItem = {
    id: string
    label: string
    dataType: 'BOOLEAN' | 'NUMBER' | 'TEXT' | 'DATE' | 'SELECT' | 'MULTI_SELECT'
    isRequired: boolean
    sortOrder: number
    selectSource?: SelectSource
    selectQuery?: string // Required when selectSource is SQL
    options?: ChecklistTemplateOption[]
}

export type ChecklistTemplate = {
    id: string
    code: string
    name: string
    entryType: EntryType
    items: ChecklistTemplateItem[]
}