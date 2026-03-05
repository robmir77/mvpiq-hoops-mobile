// C:\MVPiQHoopsMobile\src\features\auth\screens\LoginScreen.tsx
import React, { useState, useContext } from 'react';
import {
    View,
    Text,
    TextInput,
    StyleSheet,
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    TouchableOpacity,
    ActivityIndicator,
    ScrollView,
} from 'react-native';
import { login } from '../api/auth';
import { saveAuth } from '@/shared/storage/authStorage';
import { AuthContext } from '@/features/auth/context/AuthContext';

const LoginScreen = () => {
    const auth = useContext(AuthContext);
    if (!auth) return null;

    const { setUser } = auth;

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleLogin = async () => {
        if (!email || !password) {
            Alert.alert('Errore', 'Compila tutti i campi');
            return;
        }

        setLoading(true);

        try {
            const userData = await login(email, password);
            const token = userData?.token;

            if (!token) {
                throw new Error('Token non ricevuto dal server');
            }

            await saveAuth(token, userData);
            setUser(userData);
        } catch (error: any) {
            Alert.alert(
                'Errore',
                error?.message || 'Email o password non corretti'
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView
            style={{ flex: 1, backgroundColor: '#0F172A' }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <ScrollView
                contentContainerStyle={styles.container}
                keyboardShouldPersistTaps="handled"
            >
                <Image
                    source={require('../../../../assets/logo.png')}
                    style={styles.logo}
                    resizeMode="contain"
                />

                <Text style={styles.title}>Bentornato</Text>
                <Text style={styles.subtitle}>
                    Accedi per continuare la tua crescita
                </Text>

                <View style={styles.card}>
                    <TextInput
                        style={styles.input}
                        placeholder="Email"
                        placeholderTextColor="#94A3B8"
                        value={email}
                        onChangeText={setEmail}
                        autoCapitalize="none"
                        keyboardType="email-address"
                    />

                    <TextInput
                        style={styles.input}
                        placeholder="Password"
                        placeholderTextColor="#94A3B8"
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                    />

                    <TouchableOpacity
                        style={styles.button}
                        onPress={handleLogin}
                        disabled={loading}
                    >
                        {loading ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={styles.buttonText}>Accedi</Text>
                        )}
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    container: {
        flexGrow: 1,
        justifyContent: 'center',
        padding: 24,
    },
    logo: {
        width: 120,
        height: 120,
        alignSelf: 'center',
        marginBottom: 30,
    },
    title: {
        fontSize: 28,
        fontWeight: '700',
        color: '#FFFFFF',
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 14,
        color: '#94A3B8',
        textAlign: 'center',
        marginBottom: 30,
    },
    card: {
        backgroundColor: '#1E293B',
        padding: 24,
        borderRadius: 20,
    },
    input: {
        backgroundColor: '#334155',
        borderRadius: 12,
        padding: 14,
        color: '#FFFFFF',
        marginBottom: 16,
    },
    button: {
        backgroundColor: '#F97316',
        padding: 16,
        borderRadius: 14,
        alignItems: 'center',
        marginTop: 10,
    },
    buttonText: {
        color: '#FFFFFF',
        fontWeight: '600',
        fontSize: 16,
    },
});

export default LoginScreen;