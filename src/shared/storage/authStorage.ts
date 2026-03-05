import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

export const saveAuth = async (token: string, user: any) => {
    await AsyncStorage.multiSet([
        [TOKEN_KEY, token],
        [USER_KEY, JSON.stringify(user)],
    ]);
};

export const loadAuth = async () => {
    const values = await AsyncStorage.multiGet([TOKEN_KEY, USER_KEY]);

    const token = values[0][1];
    const userRaw = values[1][1];

    return {
        token,
        user: userRaw ? JSON.parse(userRaw) : null,
    };
};

export const clearAuth = async () => {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
};