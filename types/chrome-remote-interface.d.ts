declare module 'chrome-remote-interface' {
  interface CDPOptions {
    target?: string;
    port?: number;
    host?: string;
  }

  interface ListOptions {
    port?: number;
    host?: string;
  }

  interface Target {
    id: string;
    title: string;
    url: string;
    type: string;
    webSocketDebuggerUrl: string;
  }

  interface EvaluateResult {
    result: {
      value: any;
      type?: string;
    };
    exceptionDetails?: {
      text: string;
    };
  }

  interface Runtime {
    evaluate(params: { expression: string; returnByValue?: boolean }): Promise<EvaluateResult>;
  }

  interface Client {
    Runtime: Runtime;
    close(): Promise<void>;
  }

  function CDP(options?: CDPOptions): Promise<Client>;

  namespace CDP {
    function List(options?: ListOptions): Promise<Target[]>;
    type Client = import('chrome-remote-interface').Client;
  }

  export = CDP;
}
