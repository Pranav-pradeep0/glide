// ErrorBoundary.tsx
import React, { Component, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Share, NativeModules } from 'react-native';
import { useTheme } from '@/hooks/useTheme';

// Props for the ErrorBoundary component
interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: React.ComponentType<FallbackProps>;
    onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
    onReset?: () => void;
}

interface FallbackProps {
    error: Error;
    resetError: () => void;
    /** False when the last Try Again went straight back into a crash. */
    canRetry: boolean;
}

// A crash this soon after Try Again is the same crash again, not a new one.
const RETRY_CRASH_WINDOW_MS = 5000;

// State for the ErrorBoundary component
interface ErrorBoundaryState {
    error: Error | null;
    canRetry: boolean;
}

// The main ErrorBoundary class component
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { error: null, canRetry: true };
    }

    /**
     * Switches to the fallback during the render that failed.
     *
     * componentDidCatch alone is a commit-phase setState: React has already thrown away
     * the tree by then, and a boundary without this is the documented way to end up with a
     * blank screen instead of a fallback.
     */
    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        return { error };
    }

    // Called after the fallback is already on screen; this is where the logging goes.
    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        console.error('[ErrorBoundary] Caught an error:', error, errorInfo);
        // A crash before navigation is ready would otherwise sit under the splash, which
        // only lifts on navReady. Hiding twice is harmless.
        NativeModules.SplashModule?.hide();
        this.setState({ error, canRetry: Date.now() - this.lastResetAt > RETRY_CRASH_WINDOW_MS });

        // Call the optional onError prop if provided
        if (this.props.onError) {
            this.props.onError(error, errorInfo);
        }
    }

    private lastResetAt = 0;

    // Function to reset the error state and re-render the children
    resetError = (): void => {
        console.log('[ErrorBoundary] Resetting error state');
        this.lastResetAt = Date.now();
        this.setState({ error: null });
        if (this.props.onReset) {
            this.props.onReset();
        }
    };

    render(): ReactNode {
        const { error, canRetry } = this.state;
        const { children, fallback: FallbackComponent } = this.props;

        // If an error occurred, render the fallback UI
        if (error) {
            // Use the provided fallback component or the default one
            const Fallback = FallbackComponent || ErrorBoundaryFallback;

            return <Fallback error={error} resetError={this.resetError} canRetry={canRetry} />;
        }

        // If no error occurred, render the children
        return children;
    }
}

// Default fallback component to render when an error occurs. Plain RN only: it has to
// render even when the crash came from the app's own UI components.
const ErrorBoundaryFallback: React.FC<FallbackProps> = ({ error, resetError, canRetry }) => {
    const { colors } = useTheme();

    // There is no crash reporting yet, so the user sends the details themselves.
    const handleShare = () => {
        Share.share({ message: `${error.toString()}

${error.stack ?? ''}` }).catch(() => {});
    };

    return (
        <View style={[styles.fallbackContainer, { backgroundColor: colors.background }]}>
            <Text style={[styles.fallbackTitle, { color: colors.error }]}>Oops! Something went wrong.</Text>
            <Text style={[styles.fallbackMessage, { color: colors.textSecondary }]}>{error.toString()}</Text>
            {!canRetry && (
                <Text style={[styles.fallbackMessage, { color: colors.textSecondary }]}>
                    Trying again did not help. Please close and reopen Glide.
                </Text>
            )}
            <View style={styles.buttonContainer}>
                <TouchableOpacity style={[styles.button, { backgroundColor: colors.fill }]} onPress={handleShare}>
                    <Text style={[styles.buttonText, { color: colors.text }]}>Share details</Text>
                </TouchableOpacity>
                {canRetry && (
                    <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary }]} onPress={resetError}>
                        <Text style={[styles.buttonText, { color: colors.onPrimary }]}>Try Again</Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
};

// Styles for the fallback component
const styles = StyleSheet.create({
    fallbackContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    fallbackTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 10,
        textAlign: 'center',
    },
    fallbackMessage: {
        fontSize: 16,
        marginBottom: 20,
        textAlign: 'center',
        paddingHorizontal: 10,
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        width: '100%',
        paddingHorizontal: 20,
    },
    button: {
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 8,
        minWidth: 100,
        alignItems: 'center',
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '600',
    },
});

export { ErrorBoundary };
