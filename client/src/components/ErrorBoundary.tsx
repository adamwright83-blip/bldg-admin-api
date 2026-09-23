import { cn } from "@/lib/utils";
import { customerFatalNotice, createFatalCorrelationId } from "@shared/clientFatal";
import { AlertTriangle, RotateCcw } from "lucide-react";
import React, { ReactNode } from "react";
import { reportClientFatal } from "./reportClientFatal";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  correlationId: string | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, correlationId: null };
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    const correlationId = createFatalCorrelationId();
    this.setState({ correlationId });
    reportClientFatal(error, correlationId);
  }

  render() {
    if (this.state.hasError) {
      const notice = customerFatalNotice(this.state.correlationId);
      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-md p-8 text-center">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl mb-2">{notice.headline}</h2>
            <p className="text-sm text-muted-foreground mb-4">{notice.recovery}</p>
            {notice.correlationId ? (
              <p className="text-xs text-muted-foreground mb-6 break-all">
                Reference {notice.correlationId}
              </p>
            ) : null}

            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 cursor-pointer"
              )}
            >
              <RotateCcw size={16} />
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
