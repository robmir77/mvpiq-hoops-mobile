// src/features/workouts/components/WorkoutControls.tsx
//
// Control panel component for workout session
// Includes toggle buttons, manual shot entry, and session controls

import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Zap } from 'lucide-react-native'
import type { ShotResult } from '../types/workouts.types'

export type TorchMode = 'auto' | 'on' | 'off'

interface WorkoutControlsProps {
    isPaused: boolean
    isEnding: boolean
    isRecording: boolean
    isVideoRecording: boolean
    videoDuration: number
    ballEnabled: boolean
    poseEnabled: boolean
    rimDetectionEnabled: boolean
    debugMode: boolean
    diagnosticMode: boolean
    torchMode: TorchMode
    torchAvailable: boolean
    torchAutoReady: boolean
    autoStatusText: string
    autoDotActive: boolean
    onToggleBall: () => void
    onTogglePose: () => void
    onToggleRim: () => void
    onToggleDebug: () => void
    onToggleDiagnostic: () => void
    onCycleTorch: () => void
    onManualShot: (result: ShotResult) => void
    onToggleVideoRecording: () => void
    onEndSession: () => void
}

const ToggleButton = ({ active, disabled, labelOn, labelOff, onPress }: any) => (
    <TouchableOpacity
        style={[
            styles.toggleBtn,
            active ? styles.toggleBtnOn : styles.toggleBtnOff,
            disabled && styles.btnDisabled
        ]}
        onPress={onPress}
        disabled={disabled}
    >
        <Text style={[styles.toggleBtnText, active ? styles.toggleBtnTextOn : styles.toggleBtnTextOff]}>
            {active ? labelOn : labelOff}
        </Text>
    </TouchableOpacity>
)

const formatVideoDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

export const WorkoutControls: React.FC<WorkoutControlsProps> = ({
    isPaused,
    isEnding,
    isRecording,
    isVideoRecording,
    videoDuration,
    ballEnabled,
    poseEnabled,
    rimDetectionEnabled,
    debugMode,
    diagnosticMode,
    torchMode,
    torchAvailable,
    torchAutoReady,
    autoStatusText,
    autoDotActive,
    onToggleBall,
    onTogglePose,
    onToggleRim,
    onToggleDebug,
    onToggleDiagnostic,
    onCycleTorch,
    onManualShot,
    onToggleVideoRecording,
    onEndSession,
}) => {
    return (
        <View style={styles.controls}>
            {isPaused && <Text style={styles.pausedLabel}>⏸ Sessione in pausa</Text>}
            <View style={styles.autoRow}>
                <View style={styles.autoStatus}>
                    <View style={[styles.autoDot, autoDotActive && styles.autoDotActive]} />
                    <Text style={styles.autoLabel}>{autoStatusText}</Text>
                </View>
                <TouchableOpacity
                    style={[
                        styles.recControlBtn,
                        isVideoRecording ? styles.recControlBtnActive : styles.recControlBtnIdle,
                        (isPaused || isEnding) && styles.btnDisabled,
                    ]}
                    onPress={onToggleVideoRecording}
                    disabled={isPaused || isEnding}
                >
                    <Text style={styles.recControlBtnText}>
                        {isVideoRecording ? `⏹ Stop REC (${formatVideoDuration(videoDuration)})` : '🔴 Record'}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.endBtn, isEnding && styles.endBtnDisabled]}
                    onPress={onEndSession}
                    disabled={isEnding}
                >
                    <Text style={styles.endBtnText}>{isEnding ? '...' : '⏹ Fine'}</Text>
                </TouchableOpacity>
            </View>
            <View style={styles.toggleRow}>
                <ToggleButton
                    active={ballEnabled}
                    disabled={isPaused || isEnding}
                    labelOn="🏀 Palla"
                    labelOff="🏀 Palla"
                    onPress={onToggleBall}
                />
                <ToggleButton
                    active={poseEnabled}
                    disabled={isPaused || isEnding}
                    labelOn="🧍 Pose"
                    labelOff="🧍 Pose"
                    onPress={onTogglePose}
                />
                <ToggleButton
                    active={rimDetectionEnabled}
                    disabled={isPaused || isEnding}
                    labelOn="🏀 Canestro"
                    labelOff="🏀 Canestro"
                    onPress={onToggleRim}
                />
                <ToggleButton
                    active={debugMode}
                    disabled={isPaused || isEnding}
                    labelOn="🔍 Debug"
                    labelOff="🔍 Debug"
                    onPress={onToggleDebug}
                />
                <ToggleButton
                    active={diagnosticMode}
                    disabled={isPaused || isEnding}
                    labelOn="🏀 SHOT"
                    labelOff="🏀 SHOT"
                    onPress={onToggleDiagnostic}
                />
            </View>
            <View style={styles.torchRow}>
                <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={torchAvailable ? `Torcia ${torchMode.toUpperCase()}` : 'Torcia non disponibile'}
                    style={[
                        styles.torchBtn,
                        torchMode === 'on' ? styles.torchBtnOn : torchMode === 'auto' ? styles.torchBtnAuto : styles.torchBtnOff,
                        (!torchAvailable || isPaused || isEnding) && styles.btnDisabled,
                    ]}
                    onPress={onCycleTorch}
                    disabled={!torchAvailable || isPaused || isEnding}
                >
                    <Zap size={18} color={torchMode === 'on' ? '#fbbf24' : torchMode === 'auto' ? '#93c5fd' : '#9ca3af'} strokeWidth={2.5} />
                    <Text style={[
                        styles.torchBtnLabel,
                        torchMode === 'on' ? styles.torchBtnLabelOn : torchMode === 'auto' ? styles.torchBtnLabelAuto : styles.torchBtnLabelOff,
                    ]}>{torchAvailable ? torchMode.toUpperCase() : 'NON DISP.'}</Text>
                    <Text style={styles.torchBtnHint}>{torchMode === 'auto' ? (torchAutoReady ? 'Luce automatica' : 'Calibra per AUTO') : torchMode === 'on' ? 'Intensità max' : 'Luce spenta'}</Text>
                </TouchableOpacity>
                <Text style={styles.torchHelpText}>La modalità AUTO regola la torcia in base alla luminosità misurata in calibrazione.</Text>
            </View>
            <View style={styles.manualRow}>
                <Text style={styles.manualLabel}>Correzione:</Text>
                <TouchableOpacity
                    style={[styles.manualMadeBtn, (isRecording || isPaused) && styles.btnDisabled]}
                    onPress={() => onManualShot('MADE')}
                    disabled={isRecording || isPaused}
                >
                    <Text style={styles.manualMadeBtnText}>🏀 Canestro</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.manualMissBtn, (isRecording || isPaused) && styles.btnDisabled]}
                    onPress={() => onManualShot('MISS')}
                    disabled={isRecording || isPaused}
                >
                    <Text style={styles.manualMissBtnText}>❌ Mancato</Text>
                </TouchableOpacity>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    controls: {
        backgroundColor: '#121826',
        borderTopWidth: 1,
        borderTopColor: '#2a2a2a',
        padding: 14,
    },
    pausedLabel: {
        fontSize: 12,
        color: '#fbbf24',
        textAlign: 'center',
        marginBottom: 8,
        fontWeight: '600',
    },
    autoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    autoStatus: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        flex: 1,
    },
    toggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        marginBottom: 10,
    },
    autoDot: {
        width: 9,
        height: 9,
        borderRadius: 4.5,
    },
    autoDotActive: {
        backgroundColor: '#4ade80',
    },
    autoDotIdle: {
        backgroundColor: '#555',
    },
    autoLabel: {
        fontSize: 12,
        color: '#aaa',
        fontWeight: '500',
    },
    toggleBtn: {
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 8,
        marginRight: 4,
    },
    toggleBtnOn: {
        backgroundColor: 'rgba(34, 197, 94, 0.2)',
        borderWidth: 1,
        borderColor: '#22c55e',
    },
    toggleBtnOff: {
        backgroundColor: 'rgba(100, 100, 100, 0.2)',
        borderWidth: 1,
        borderColor: '#666',
    },
    toggleBtnText: {
        fontSize: 11,
        fontWeight: '700',
    },
    toggleBtnTextOn: {
        color: '#22c55e',
    },
    toggleBtnTextOff: {
        color: '#888',
    },
    recControlBtn: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 10,
        alignItems: 'center',
        marginRight: 6,
    },
    recControlBtnIdle: {
        backgroundColor: '#2a1515',
        borderWidth: 1,
        borderColor: '#ef4444',
    },
    recControlBtnActive: {
        backgroundColor: '#ef4444',
        borderWidth: 1,
        borderColor: '#fca5a5',
    },
    recControlBtnText: {
        color: '#fff',
        fontWeight: '800',
        fontSize: 12,
    },
    torchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 10,
        paddingVertical: 2,
    },
    torchBtn: {
        minWidth: 112,
        paddingHorizontal: 13,
        paddingVertical: 9,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
    },
    torchBtnAuto: { backgroundColor: 'rgba(59,130,246,0.12)', borderColor: '#3b82f6' },
    torchBtnOn: { backgroundColor: 'rgba(251,191,36,0.14)', borderColor: '#fbbf24' },
    torchBtnOff: { backgroundColor: 'rgba(107,114,128,0.10)', borderColor: '#4b5563' },
    torchBtnLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    torchBtnLabelAuto: { color: '#93c5fd' },
    torchBtnLabelOn: { color: '#fbbf24' },
    torchBtnLabelOff: { color: '#9ca3af' },
    torchBtnHint: { color: '#9ca3af', fontSize: 9, fontWeight: '600' },
    torchHelpText: { flex: 1, color: '#737d90', fontSize: 10, lineHeight: 14 },
    manualRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderTopWidth: 1,
        borderTopColor: '#1e2433',
        paddingTop: 10,
    },
    manualLabel: {
        fontSize: 11,
        color: '#555',
        fontWeight: '600',
    },
    manualMadeBtn: {
        flex: 1,
        paddingVertical: 9,
        borderRadius: 10,
        backgroundColor: '#14301a',
        borderWidth: 1,
        borderColor: '#22c55e',
        alignItems: 'center',
    },
    manualMadeBtnText: {
        color: '#22c55e',
        fontWeight: '700',
        fontSize: 12,
    },
    manualMissBtn: {
        flex: 1,
        paddingVertical: 9,
        borderRadius: 10,
        backgroundColor: '#2a1414',
        borderWidth: 1,
        borderColor: '#ef4444',
        alignItems: 'center',
    },
    manualMissBtnText: {
        color: '#ef4444',
        fontWeight: '700',
        fontSize: 12,
    },
    btnDisabled: {
        opacity: 0.4,
    },
    endBtn: {
        backgroundColor: '#1e2433',
        borderWidth: 1,
        borderColor: '#555',
        borderRadius: 10,
        paddingVertical: 8,
        paddingHorizontal: 14,
        alignItems: 'center',
    },
    endBtnDisabled: {
        opacity: 0.5,
    },
    endBtnText: {
        color: '#888',
        fontWeight: '600',
        fontSize: 13,
    },
})
