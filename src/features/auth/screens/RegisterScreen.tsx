// C:\MVPiQHoopsMobile\src\features\auth\screens\RegisterScreen.tsx
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
import { register } from '../api/auth';
import { saveAuth } from '@/shared/storage/authStorage';
import { AuthContext } from '@/features/auth/context/AuthContext';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '@/app/navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

const RegisterScreen = ({ navigation }: Props) => {
    const auth = useContext(AuthContext);
    if (!auth) return null;

    const { setUser } = auth;

    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const handleRegister = async () => {
        if (!username || !email || !password || !confirmPassword) {
            Alert.alert('Errore', 'Compila tutti i campi');
            return;
        }

        if (password !== confirmPassword) {
            Alert.alert('Errore', 'Le password non coincidono');
            return;
        }

        if (password.length < 6) {
            Alert.alert('Errore', 'La password deve avere almeno 6 caratteri');
            return;
        }

        setLoading(true);

        try {
            const userData = await register(username, email, password, displayName);
            const token = userData?.token;

            if (!token) {
                // Registrazione riuscita ma senza token - reindirizza al login
                Alert.alert(
                    'Registrazione completata!',
                    'Account creato con successo. Ora puoi accedere con le tue credenziali.',
                    [
                        {
                            text: 'OK',
                            onPress: () => navigation.navigate('Login')
                        }
                    ]
                );
                return;
            }

            await saveAuth(token, userData);
            setUser(userData);
        } catch (error: any) {
            console.error('Errore registrazione:', error);
            
            let errorMessage = 'Registrazione fallita';
            
            if (error?.message?.toLowerCase().includes('email already in use')) {
                errorMessage = 'Questa email è già registrata. Prova con un\'altra email o accedi.';
            } else if (error?.message?.toLowerCase().includes('username already exists') || error?.message?.toLowerCase().includes('users_username_key')) {
                errorMessage = 'Questo username è già in uso. Scegline un altro.';
            } else if (error?.message?.toLowerCase().includes('password')) {
                errorMessage = 'La password non è valida. Scegli una password più sicura.';
            } else if (error?.message?.toLowerCase().includes('email')) {
                errorMessage = 'L\'email inserita non è valida.';
            } else if (error?.message) {
                errorMessage = error.message;
            }
            
            Alert.alert(
                'Errore di registrazione',
                errorMessage
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

                <Text style={styles.title}>Crea Account</Text>
                <Text style={styles.subtitle}>
                    Unisciti per iniziare la tua crescita
                </Text>

                <View style={styles.card}>
                    <TextInput
                        style={styles.input}
                        placeholder="Username"
                        placeholderTextColor="#94A3B8"
                        value={username}
                        onChangeText={setUsername}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />

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
                        placeholder="Nome visualizzato (opzionale)"
                        placeholderTextColor="#94A3B8"
                        value={displayName}
                        onChangeText={setDisplayName}
                        autoCapitalize="words"
                    />

                    <View style={styles.inputContainer}>
                        <TextInput
                            style={styles.inputWithIcon}
                            placeholder="Password"
                            placeholderTextColor="#94A3B8"
                            value={password}
                            onChangeText={setPassword}
                            secureTextEntry={!showPassword}
                        />
                        <TouchableOpacity
                            style={styles.eyeIcon}
                            onPress={() => setShowPassword(!showPassword)}
                        >
                            <Text style={styles.eyeText}>
                                {showPassword ? '🙈' : '👁️'}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.inputContainer}>
                        <TextInput
                            style={styles.inputWithIcon}
                            placeholder="Conferma Password"
                            placeholderTextColor="#94A3B8"
                            value={confirmPassword}
                            onChangeText={setConfirmPassword}
                            secureTextEntry={!showConfirmPassword}
                        />
                        <TouchableOpacity
                            style={styles.eyeIcon}
                            onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                        >
                            <Text style={styles.eyeText}>
                                {showConfirmPassword ? '🙈' : '👁️'}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                        style={styles.button}
                        onPress={handleRegister}
                        disabled={loading}
                    >
                        {loading ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={styles.buttonText}>Crea Account</Text>
                        )}
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.linkButton}
                        onPress={() => navigation.navigate('Login')}
                    >
                        <Text style={styles.linkText}>
                            Hai già un account? Accedi
                        </Text>
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
    inputContainer: {
        position: 'relative',
        marginBottom: 16,
    },
    inputWithIcon: {
        backgroundColor: '#334155',
        borderRadius: 12,
        padding: 14,
        color: '#FFFFFF',
        paddingRight: 45,
    },
    eyeIcon: {
        position: 'absolute',
        right: 15,
        top: 14,
        padding: 5,
    },
    eyeText: {
        fontSize: 16,
        color: '#94A3B8',
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
    linkButton: {
        marginTop: 20,
        alignItems: 'center',
    },
    linkText: {
        color: '#F97316',
        fontSize: 14,
        fontWeight: '500',
    },
});

export default RegisterScreen;
