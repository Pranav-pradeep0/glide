// ErrorBoundary.tsx
import React, { Component, ReactNode, createContext, useContext } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';

// Define the shape of the error boundary context
interface ErrorBoundaryContextType {
    error: Error | null;
    resetError: () => void;
    logError: (error: Error, errorInfo: React.ErrorInfo) => void;
}

// Create the context with a default value
const ErrorBoundaryContext = createContext<ErrorBoundaryContextType | undefined>(undefined);

// Props for the ErrorBoundary component
interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: React.ComponentType<{ error: Error; resetError: () => void; logError: (error: Error, errorInfo: React.ErrorInfo) => void }>;
    onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
    onReset?: () => void;
}

// State for the ErrorBoundary component
interface ErrorBoundaryState {
    error: Error | null;
    errorInfo: React.ErrorInfo | null;
}

// The main ErrorBoundary class component
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { error: null, errorInfo: null };
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
        this.setState({ error, errorInfo });

        // Log the error using the utility function
        logError(error, errorInfo);

        // Call the optional onError prop if provided
        if (this.props.onError) {
            this.props.onError(error, errorInfo);
        }
    }

    // Function to reset the error state and re-render the children
    resetError = (): void => {
        console.log('[ErrorBoundary] Resetting error state');
        this.setState({ error: null, errorInfo: null });
        if (this.props.onReset) {
            this.props.onReset();
        }
    };

    // Function to log the error (can be called by children via context)
    logError = (error: Error, errorInfo: React.ErrorInfo): void => {
        console.error('[ErrorBoundary] Error logged via context:', error, errorInfo);
        logError(error, errorInfo); // Use the utility function
    };

    render(): ReactNode {
        const { error, errorInfo } = this.state;
        const { children, fallback: FallbackComponent } = this.props;

        // If an error occurred, render the fallback UI
        if (error) {
            const contextValue: ErrorBoundaryContextType = {
                error,
                resetError: this.resetError,
                logError: this.logError,
            };

            // Use the provided fallback component or the default one
            const Fallback = FallbackComponent || ErrorBoundaryFallback;

            return (
                <ErrorBoundaryContext.Provider value={contextValue}>
                    <Fallback error={error} resetError={this.resetError} logError={this.logError} />
                </ErrorBoundaryContext.Provider>
            );
        }

        // If no error occurred, render the children
        return children;
    }
}

// Default fallback component to render when an error occurs
const ErrorBoundaryFallback: React.FC<{ error: Error; resetError: () => void; logError: (error: Error, errorInfo: React.ErrorInfo) => void }> = ({ error, resetError, logError }) => {
    const handleReset = () => {
        resetError();
    };

    const handleLogError = () => {
        // ErrorInfo is not available here, but we can pass a mock one if needed
        // For simplicity, we'll pass an empty object or null where ErrorInfo is expected
        logError(error, { componentStack: error.stack || '' });
        Alert.alert('Error Reported', 'The error details have been logged.');
    };

    return (
        <View style={styles.fallbackContainer}>
            <Text style={styles.fallbackTitle}>Oops! Something went wrong.</Text>
            <Text style={styles.fallbackMessage}>{error.toString()}</Text>
            <View style={styles.buttonContainer}>
                <TouchableOpacity style={[styles.button, { backgroundColor: '#007AFF' }]} onPress={handleLogError}>
                    <Text style={styles.buttonText}>Report Error</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, { backgroundColor: '#575757' }]} onPress={handleReset}>
                    <Text style={styles.buttonText}>Try Again</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

// Hook to use the ErrorBoundary context
const useErrorBoundary = (): ErrorBoundaryContextType => {
    const context = useContext(ErrorBoundaryContext);
    if (context === undefined) {
        throw new Error('useErrorBoundary must be used within an ErrorBoundaryProvider');
    }
    return context;
};

// Utility function for logging errors (replace with your preferred logging service)
const logError = (error: Error, errorInfo: React.ErrorInfo): void => {
    // Example: Log to console (production builds might disable this or send to a service)
    console.group('[ErrorBoundary] Logging Error');
    console.error('Error Object:', error);
    console.error('Error Info (Component Stack):', errorInfo);
    console.groupEnd();

    // Example: Send to a logging service like Sentry, Bugsnag, etc.
    // import * as Sentry from '@sentry/react-native';
    // Sentry.captureException(error, { contexts: { react: { componentStack: errorInfo.componentStack } } });
};

// Styles for the fallback component
const styles = StyleSheet.create({
    fallbackContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
        backgroundColor: '#f5f5f5', // Light background for contrast
    },
    fallbackTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#FF3B30', // Red color for error
        marginBottom: 10,
        textAlign: 'center',
    },
    fallbackMessage: {
        fontSize: 16,
        color: '#555',
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
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
});

export { ErrorBoundary, useErrorBoundary };
