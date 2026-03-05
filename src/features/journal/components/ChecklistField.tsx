import React from 'react'
import {
    View,
    Text,
    TextInput,
    Switch,
    TouchableOpacity,
    StyleSheet,
} from 'react-native'
import { ChecklistTemplateItem } from '../types/journal.types'

type Props = {
    item: ChecklistTemplateItem
    value: any
    onChange: (val: any) => void
}

export function ChecklistField({ item, value, onChange }: Props) {
    return (
        <View style={styles.container}>
            <Text style={styles.label}>
                {item.label} {item.isRequired ? '*' : ''}
            </Text>

            {item.dataType === 'BOOLEAN' && (
                <Switch value={!!value} onValueChange={onChange} />
            )}

            {item.dataType === 'NUMBER' && (
                <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    value={value?.toString() ?? ''}
                    onChangeText={(t) => onChange(t ? Number(t) : null)}
                />
            )}

            {item.dataType === 'TEXT' && (
                <TextInput
                    style={[styles.input, { height: 80 }]}
                    multiline
                    value={value ?? ''}
                    onChangeText={onChange}
                />
            )}

            {item.dataType === 'SELECT' &&
                item.options?.map((opt) => (
                    <TouchableOpacity
                        key={opt.id}
                        style={styles.option}
                        onPress={() => onChange(opt.valueCode)}
                    >
                        <Text style={{ color: 'white' }}>
                            {value === opt.valueCode ? '🔘' : '⚪'} {opt.valueLabel}
                        </Text>
                    </TouchableOpacity>
                ))}
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
    option: {
        paddingVertical: 6,
    },
})