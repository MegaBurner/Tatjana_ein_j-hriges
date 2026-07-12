import { Component, type ReactNode } from 'react';

interface SceneErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface SceneErrorBoundaryState {
  hasError: boolean;
}

/** Fängt Render-/Loader-Fehler in WebGL-Szenen ab und zeigt den 2D-Fallback. */
class SceneErrorBoundary extends Component<SceneErrorBoundaryProps, SceneErrorBoundaryState> {
  state: SceneErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): SceneErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export default SceneErrorBoundary;
