import React, { useState } from 'react'
import {
    View,
    Text,
    TextInput,
    Switch,
    TouchableOpacity,
    StyleSheet,
    Modal,
    ScrollView,
} from 'react-native'
import { ChecklistTemplateItem, ChecklistTemplateItemOption } from '../types/journal.types'

type Props = {
    item: ChecklistTemplateItem
    value: any
    onChange: (val: any) => void
    dynamicOptions?: ChecklistTemplateItemOption[]
}

export function ChecklistField({ item, value, onChange, dynamicOptions }: Props) {
    const [showComboBox, setShowComboBox] = useState(false)
    const [showMultiSelectModal, setShowMultiSelectModal] = useState(false)

    const handleMultiSelectToggle = (valueCode: string) => {
        const currentValues = value || []
        if (currentValues.includes(valueCode)) {
            onChange(currentValues.filter((v: string) => v !== valueCode))
        } else {
            onChange([...currentValues, valueCode])
        }
    }

    // Use dynamic options if selectSource is not STATIC, otherwise use static options
    const options = item.selectSource && item.selectSource !== 'STATIC'
        ? dynamicOptions || []
        : item.options || []

    const getSelectedLabel = () => {
        if (item.dataType === 'SELECT') {
            const selectedOption = options.find(opt => opt.valueCode === value)
            return selectedOption?.valueLabel || 'Seleziona...'
        }
        return 'Seleziona...'
    }

    const getMultiSelectLabel = () => {
        const selectedValues = value || []
        if (selectedValues.length === 0) return 'Seleziona...'
        if (selectedValues.length === 1) {
            const opt = options.find(o => o.valueCode === selectedValues[0])
            return opt?.valueLabel || 'Seleziona...'
        }
        return `${selectedValues.length} selezionati`
    }

    return (
        <View style={styles.container}>
            <Text style={styles.label}>
                {item.label} {item.isRequired ? '*' : ''}
            </Text>

            {item.dataType === 'BOOLEAN' && (
                <Switch value={!!value} onValueChange={onChange} />
            )}

            {item.dataType === 'NUMBER' && (
                <View style={styles.numberContainer}>
                    <TouchableOpacity
                        style={styles.numberButton}
                        onPress={() => onChange((value || 0) - 1)}
                    >
                        <Text style={styles.numberButtonText}>−</Text>
                    </TouchableOpacity>
                    <TextInput
                        style={styles.numberInput}
                        keyboardType="numeric"
                        value={value?.toString() ?? ''}
                        onChangeText={(t) => onChange(t ? Number(t) : null)}
                    />
                    <TouchableOpacity
                        style={styles.numberButton}
                        onPress={() => onChange((value || 0) + 1)}
                    >
                        <Text style={styles.numberButtonText}>+</Text>
                    </TouchableOpacity>
                </View>
            )}

            {item.dataType === 'TEXT' && (
                <TextInput
                    style={[styles.input, { height: 80 }]}
                    multiline
                    value={value ?? ''}
                    onChangeText={onChange}
                />
            )}

            {item.dataType === 'DATE' && (
                <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#666"
                    value={value ?? ''}
                    onChangeText={onChange}
                />
            )}

            {item.dataType === 'SELECT' && (
                <>
                    <TouchableOpacity
                        style={styles.comboBoxButton}
                        onPress={() => setShowComboBox(true)}
                    >
                        <Text style={styles.comboBoxText}>
                            {getSelectedLabel()}
                        </Text>
                        <Text style={styles.comboBoxArrow}>▼</Text>
                    </TouchableOpacity>

                    <Modal
                        visible={showComboBox}
                        transparent
                        animationType="fade"
                        onRequestClose={() => setShowComboBox(false)}
                    >
                        <View style={styles.modalOverlay}>
                            <View style={styles.modalContent}>
                                <Text style={styles.modalTitle}>{item.label}</Text>
                                <ScrollView style={styles.optionsList}>
                                    {options?.map((opt) => (
                                        <TouchableOpacity
                                            key={opt.valueCode}
                                            style={[
                                                styles.modalOption,
                                                value === opt.valueCode && styles.modalOptionSelected
                                            ]}
                                            onPress={() => {
                                                onChange(opt.valueCode)
                                                setShowComboBox(false)
                                            }}
                                        >
                                            <Text style={[
                                                styles.modalOptionText,
                                                value === opt.valueCode && styles.modalOptionTextSelected
                                            ]}>
                                                {opt.valueLabel}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </ScrollView>
                                <TouchableOpacity
                                    style={styles.modalCloseButton}
                                    onPress={() => setShowComboBox(false)}
                                >
                                    <Text style={styles.modalCloseButtonText}>Chiudi</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </Modal>
                </>
            )}

            {item.dataType === 'MULTI_SELECT' && (
                <>
                    <TouchableOpacity
                        style={styles.comboBoxButton}
                        onPress={() => setShowMultiSelectModal(true)}
                    >
                        <Text style={styles.comboBoxText}>
                            {getMultiSelectLabel()}
                        </Text>
                        <Text style={styles.comboBoxArrow}>▼</Text>
                    </TouchableOpacity>

                    <Modal
                        visible={showMultiSelectModal}
                        transparent
                        animationType="fade"
                        onRequestClose={() => setShowMultiSelectModal(false)}
                    >
                        <View style={styles.modalOverlay}>
                            <View style={styles.modalContent}>
                                <Text style={styles.modalTitle}>{item.label}</Text>
                                <ScrollView style={styles.optionsList}>
                                    {options?.map((opt) => {
                                        const isSelected = (value || []).includes(opt.valueCode)
                                        return (
                                            <TouchableOpacity
                                                key={opt.valueCode}
                                                style={[
                                                    styles.modalOption,
                                                    isSelected && styles.modalOptionSelected
                                                ]}
                                                onPress={() => handleMultiSelectToggle(opt.valueCode)}
                                            >
                                                <View style={styles.multiSelectRow}>
                                                    <Text style={[
                                                        styles.multiSelectCheckbox,
                                                        isSelected && styles.multiSelectCheckboxSelected
                                                    ]}>
                                                        {isSelected ? '☑️' : '☐'}
                                                    </Text>
                                                    <Text style={[
                                                        styles.modalOptionText,
                                                        isSelected && styles.modalOptionTextSelected
                                                    ]}>
                                                        {opt.valueLabel}
                                                    </Text>
                                                </View>
                                            </TouchableOpacity>
                                        )
                                    })}
                                </ScrollView>
                                <TouchableOpacity
                                    style={styles.modalCloseButton}
                                    onPress={() => setShowMultiSelectModal(false)}
                                >
                                    <Text style={styles.modalCloseButtonText}>Chiudi</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </Modal>
                </>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        marginBottom: 20,
    },
    label: {
        color: 'white',
        marginBottom: 8,
        fontWeight: 'bold',
    },
    input: {
        backgroundColor: '#121826',
        color: 'white',
        padding: 10,
        borderRadius: 8,
    },
    numberContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    numberButton: {
        backgroundColor: '#ff8c00',
        width: 44,
        height: 44,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    numberButtonText: {
        color: 'white',
        fontSize: 20,
        fontWeight: 'bold',
    },
    numberInput: {
        backgroundColor: '#121826',
        color: 'white',
        padding: 10,
        borderRadius: 8,
        flex: 1,
        textAlign: 'center',
        fontSize: 16,
    },
    comboBoxButton: {
        backgroundColor: '#121826',
        padding: 12,
        borderRadius: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    comboBoxText: {
        color: 'white',
        fontSize: 16,
    },
    comboBoxArrow: {
        color: '#ff8c00',
        fontSize: 12,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    modalContent: {
        backgroundColor: '#1a1a1a',
        borderRadius: 16,
        width: '100%',
        maxWidth: 400,
        maxHeight: 400,
        borderWidth: 2,
        borderColor: '#ff8c00',
    },
    modalTitle: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#333',
    },
    optionsList: {
        maxHeight: 300,
    },
    modalOption: {
        padding: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#333',
    },
    modalOptionSelected: {
        backgroundColor: '#ff8c00',
    },
    modalOptionText: {
        color: 'white',
        fontSize: 16,
    },
    modalOptionTextSelected: {
        fontWeight: 'bold',
    },
    modalCloseButton: {
        backgroundColor: '#ff8c00',
        padding: 16,
        alignItems: 'center',
        borderBottomLeftRadius: 14,
        borderBottomRightRadius: 14,
    },
    modalCloseButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
    multiSelectRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    multiSelectCheckbox: {
        fontSize: 20,
        color: '#94A3B8',
    },
    multiSelectCheckboxSelected: {
        color: '#ff8c00',
    },
    option: {
        paddingVertical: 6,
    },
})