// src/features/subscriptions/api/subscriptions.api.ts

import apiClient from '@/shared/api/apiClient'
import { Subscription, SubscriptionLimits, SubscriptionFeature } from '../types/subscriptions.types'

/**
 * GET Subscription details
 */
export const getUserSubscription = async (userId: string): Promise<Subscription> => {
    try {
        const response = await apiClient.get<Subscription>(
            `/users/${userId}/subscription`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento subscription:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message || 'Errore caricamento subscription'
        )
    }
}

/**
 * GET Check premium access
 */
export const checkPremiumAccess = async (userId: string): Promise<{ isPremium: boolean }> => {
    try {
        const response = await apiClient.get<{ isPremium: boolean }>(
            `/users/${userId}/subscription/premium`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore verifica accesso premium:',
            error?.response?.data || error.message
        )
        return { isPremium: false }
    }
}

/**
 * GET Check scout access
 */
export const checkScoutAccess = async (userId: string): Promise<{ hasScoutAccess: boolean }> => {
    try {
        const response = await apiClient.get<{ hasScoutAccess: boolean }>(
            `/users/${userId}/subscription/scout-access`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore verifica accesso scout:',
            error?.response?.data || error.message
        )
        return { hasScoutAccess: false }
    }
}

/**
 * GET Check creator access
 */
export const checkCreatorAccess = async (userId: string): Promise<{ hasCreatorAccess: boolean }> => {
    try {
        const response = await apiClient.get<{ hasCreatorAccess: boolean }>(
            `/users/${userId}/subscription/creator-access`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore verifica accesso creator:',
            error?.response?.data || error.message
        )
        return { hasCreatorAccess: false }
    }
}

/**
 * GET Subscription plan
 */
export const getSubscriptionPlan = async (userId: string): Promise<{ plan: string }> => {
    try {
        const response = await apiClient.get<{ plan: string }>(
            `/users/${userId}/subscription/plan`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento piano subscription:',
            error?.response?.data || error.message
        )
        return { plan: 'FREE' }
    }
}

/**
 * POST Upgrade to premium
 */
export const upgradeToPremium = async (userId: string): Promise<Subscription> => {
    try {
        const response = await apiClient.post<Subscription>(
            `/users/${userId}/subscription/upgrade-premium`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore upgrade a premium:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message || 'Errore upgrade a premium'
        )
    }
}

/**
 * GET Check feature access
 */
export const checkFeatureAccess = async (
    userId: string,
    feature: string
): Promise<{ hasAccess: boolean }> => {
    try {
        const response = await apiClient.get<{ hasAccess: boolean }>(
            `/users/${userId}/subscription/features/${feature}`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore verifica accesso feature:',
            error?.response?.data || error.message
        )
        return { hasAccess: false }
    }
}

/**
 * GET Video upload limits
 */
export const getVideoUploadLimits = async (userId: string): Promise<SubscriptionLimits> => {
    try {
        const response = await apiClient.get<SubscriptionLimits>(
            `/users/${userId}/subscription/video-upload-limits`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento limiti upload video:',
            error?.response?.data || error.message
        )
        return {
            videoUploadLimit: 0,
            videoAnalysisLimit: 0,
            videoUploadUsed: 0,
            videoAnalysisUsed: 0
        }
    }
}

/**
 * GET Video analysis limits
 */
export const getVideoAnalysisLimits = async (userId: string): Promise<SubscriptionLimits> => {
    try {
        const response = await apiClient.get<SubscriptionLimits>(
            `/users/${userId}/subscription/video-analysis-limits`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento limiti analisi video:',
            error?.response?.data || error.message
        )
        return {
            videoUploadLimit: 0,
            videoAnalysisLimit: 0,
            videoUploadUsed: 0,
            videoAnalysisUsed: 0
        }
    }
}

/**
 * GET Can create official content
 */
export const canCreateOfficialContent = async (userId: string): Promise<{ canCreate: boolean }> => {
    try {
        const response = await apiClient.get<{ canCreate: boolean }>(
            `/users/${userId}/subscription/can-create-official-content`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore verifica permessi contenuto ufficiale:',
            error?.response?.data || error.message
        )
        return { canCreate: false }
    }
}

/**
 * GET Can access analytics
 */
export const canAccessAnalytics = async (userId: string): Promise<{ canAccess: boolean }> => {
    try {
        const response = await apiClient.get<{ canAccess: boolean }>(
            `/users/${userId}/subscription/can-access-analytics`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore verifica accesso analytics:',
            error?.response?.data || error.message
        )
        return { canAccess: false }
    }
}

/**
 * GET Can use advanced filters
 */
export const canUseAdvancedFilters = async (userId: string): Promise<{ canUse: boolean }> => {
    try {
        const response = await apiClient.get<{ canUse: boolean }>(
            `/users/${userId}/subscription/can-use-advanced-filters`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore verifica filtri avanzati:',
            error?.response?.data || error.message
        )
        return { canUse: false }
    }
}
