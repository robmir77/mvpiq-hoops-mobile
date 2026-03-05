export type EntryType = 'MATCH' | 'TRAINING'

export type ChecklistTemplateOption = {
    id: string
    valueCode: string
    valueLabel: string
    sortOrder: number
}

export type ChecklistTemplateItem = {
    id: string
    label: string
    dataType: 'BOOLEAN' | 'NUMBER' | 'TEXT' | 'SELECT'
    isRequired: boolean
    sortOrder: number
    options?: ChecklistTemplateOption[]
}

export type ChecklistTemplate = {
    id: string
    code: string
    name: string
    entryType: EntryType
    items: ChecklistTemplateItem[]
}