useEffect(() => {
    const handleMessage = (wsMessage: UserActionMessage | BaseWsMessage) => {
        // 处理连接状态消息
        if (wsMessage.type === "ws-status") {
            const statusData = wsMessage as any;
            if (statusData.status === "connected") {
                setWsConnected(true);
            }
            return;
        }

        // 处理错误和警告消息
        if (wsMessage.type === "error") {
            message.error((wsMessage as any)?.msg || "服务端错误");
            setWsConnected(false);
            return;
        }
        if (wsMessage.type === "warning") {
            message.warning((wsMessage as any)?.msg || "服务端警告");
            return;
        }

        // 忽略心跳消息，避免在 UI 中显示
        if (wsMessage.type === "pong") {
            return;
        }

        // 仅在“拾取中”时处理 Playwright 回传
        if (wsMessage.type === "playwright-message" && pendingPickRef.current) {
            const payload = (wsMessage as any)?.payload;
            if (payload?.type === "user-action") {
                const data = payload?.data;
                if (!data) return;
                const actionType = data?.actionType;
                if (actionType !== "click" && actionType !== "dblclick") return;

                const elementDom = data?.target?.outerHTML || "";
                const elementId = data?.target?.xpath || data?.target?.id || "";
                const pageUrl = data?.url || "";

                const picked: StepItem = {
                    stepIndex: pickStepIndexRef.current,
                    stepType: "picked",
                    pageUrl,
                    elementId,
                    elementDom,
                    mainTitle: "",
                    subTitle: "",
                };

                pendingPickRef.current = false;
                clearPickTimeout();
                setEditingStep(picked);
                setStatus("editing");
                message.success("已拾取到下一次点击的步骤信息");
            }
        }
    };