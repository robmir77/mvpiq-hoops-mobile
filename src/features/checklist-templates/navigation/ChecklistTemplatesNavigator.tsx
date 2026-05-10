import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import ChecklistTemplatesAdminScreen from '../screens/ChecklistTemplatesAdminScreen'
import ChecklistTemplateEditScreen from '../screens/ChecklistTemplateEditScreen'

export type ChecklistTemplatesStackParamList = {
    ChecklistTemplatesAdmin: undefined
    ChecklistTemplateEdit: { templateId?: string }
}

const Stack = createNativeStackNavigator<ChecklistTemplatesStackParamList>()

export default function ChecklistTemplatesNavigator() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="ChecklistTemplatesAdmin" component={ChecklistTemplatesAdminScreen} />
            <Stack.Screen name="ChecklistTemplateEdit" component={ChecklistTemplateEditScreen} />
        </Stack.Navigator>
    )
}
