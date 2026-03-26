import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Col, Empty, Input, List, Row, Space, Tag, Typography, message, Badge } from "antd";
import { openBrowser } from "../https/requests";
import { initWsMessageHandler, sendWsMessage, wsMessageHandler, closeWsConnection } from "../../utils/msgHandler";
import type { UserActionMessage, BaseWsMessage, PlaywrightCommand } from "../../types/record";
import "./RecordStepPanel.less";

type PanelStatus = "idle" | "ready" | "picking" | "editing" | "finished";

type StepItem = {
  stepIndex: number;
  stepType: "picked" | "custom";
  pageUrl: string;
  elementId: string;
  elementDom: string;
  mainTitle: string;
  subTitle: string;
};

const statusColorMap: Record<PanelStatus, string> = {
  idle: "default",
  ready: "success",
  picking: "processing",
  editing: "warning",
  finished: "blue",
};

const RecordStepPanel: React.FC = () => {
  const [status, setStatus] = useState<PanelStatus>("idle");
  const [targetUrl, setTargetUrl] = useState("https://xft.cmbchina.com/");
  const [steps, setSteps] = useState<StepItem[]>([]);
  const [editingStep, setEditingStep] = useState<StepItem | null>(null);
  const [starting, setStarting] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [latestPickedStep, setLatestPickedStep] = useState<StepItem | null>(null); // 新增：存储最新拾取的步骤

  const pendingPickRef = useRef(false);
  const pickStepIndexRef = useRef(1);
  const pickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPickTimeout = () => {
    if (pickTimeoutRef.current) {
      clearTimeout(pickTimeoutRef.current);
      pickTimeoutRef.current = null;
    }
  };

  // 使用通用消息处理器处理 WebSocket 消息
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

    // 注册消息处理器
    initWsMessageHandler(handleMessage);

    // 检查初始连接状态
    const checkConnection = () => {
      if (wsMessageHandler['ws'] && wsMessageHandler['ws'].readyState === WebSocket.OPEN) {
        setWsConnected(true);
      } else {
        setWsConnected(false);
      }
    };
    
    // 初始检查
    checkConnection();
    
    // 设置定时检查（每5秒）
    const interval = setInterval(checkConnection, 5000);
    
    return () => {
      clearInterval(interval);
      clearPickTimeout();
      // 组件卸载时不强制关闭连接，因为可能有其他组件在使用
    };
  }, []);

  // 手动重连 WebSocket
  const reconnectWs = () => {
    closeWsConnection(true); // 强制关闭现有连接
    setTimeout(() => {
      initWsMessageHandler((msg) => {
        // 重新注册相同的处理逻辑
        const handleMessage = (wsMessage: UserActionMessage | BaseWsMessage) => {
          if (wsMessage.type === "ws-status") {
            const statusData = wsMessage as any;
            if (statusData.status === "connected") {
              setWsConnected(true);
            }
            return;
          }
          if (wsMessage.type === "error") {
            message.error((wsMessage as any)?.msg || "服务端错误");
            setWsConnected(false);
            return;
          }
          if (wsMessage.type === "warning") {
            message.warning((wsMessage as any)?.msg || "服务端警告");
            return;
          }
          if (wsMessage.type === "user-action-monitor-status") {
            const statusData = wsMessage as any;
            console.log('🎯 用户操作监控状态:', statusData);
            return;
          }
          if (wsMessage.type === "playwright-message") {
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

              setLatestPickedStep(picked);
              
              if (pendingPickRef.current) {
                pendingPickRef.current = false;
                clearPickTimeout();
                setEditingStep(picked);
                setStatus("editing");
                message.success("已拾取到下一次点击的步骤信息");
              } else {
                message.info("检测到页面点击，已记录为最新拾取步骤");
              }
            }
          }
        };
        handleMessage(msg);
      });
    }, 100);
    message.info('正在尝试重新连接 WebSocket...');
  };

  const disabled = useMemo(
    () => ({
      start: status !== "idle",
      pick: status !== "ready",
      finishCurrent: status !== "editing",
      finishRecord: status !== "ready" && status !== "editing",
      exportData: status !== "finished" || steps.length === 0,
      addCustom: status !== "ready" && status !== "editing",
      targetUrlInput: status !== "idle",
    }),
    [status, steps.length],
  );

  const normalizedUrl = (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return "";
    return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  };

  const onStartRecord = async () => {
    const safeUrl = normalizedUrl(targetUrl);
    if (!safeUrl) {
      message.warning("请输入页面地址");
      return;
    }

    try {
      setStarting(true);
      // 打开页面并启用“拾取下一次点击”的注入监控 + WS 绑定
      await openBrowser(safeUrl, true);
      // 等 WS 通道就绪后进入“录入准备”
      // WebSocket 连接已在 useEffect 中初始化
      
      setTargetUrl(safeUrl);
      setSteps([]);
      setEditingStep(null);
      setLatestPickedStep(null); // 重置最新拾取步骤
      setStatus("ready");
      message.success("页面已打开，WS 通道和拾取监控已就绪");
    } catch (error: any) {
      message.error(`启动失败：${error?.message || "请检查后端服务是否运行在 3001"}`);
    } finally {
      setStarting(false);
    }
  };

  const onPickCurrentStep = () => {
    if (status !== "ready") return;

    clearPickTimeout();
    pendingPickRef.current = true;
    const nextIndex = steps.length + 1;
    pickStepIndexRef.current = nextIndex;
    setEditingStep(null);
    setStatus("picking");

    try {
      // 使用通用消息处理器发送消息
      const pickMessage: PlaywrightCommand = {
        type: 'monitor-set-pick-mode',
        enabled: true,
        timestamp: Date.now()
      };
      
      if (sendWsMessage(pickMessage)) {
        pickTimeoutRef.current = setTimeout(() => {
          if (!pendingPickRef.current) return;
          pendingPickRef.current = false;
          setStatus("ready");
          message.warning("拾取超时，请在已打开的页面点击目标元素");
        }, 30000);
      } else {
        pendingPickRef.current = false;
        setStatus("ready");
        message.error("拾取指令发送失败：WebSocket 连接未建立");
      }
    } catch (e: any) {
      pendingPickRef.current = false;
      setStatus("ready");
      message.error(`拾取指令发送失败：${e?.message || "未知错误"}`);
    }
  };

  const onFinishCurrentStep = () => {
    if (!editingStep) return;
    setSteps((prev) => [...prev, editingStep]);
    setEditingStep(null);
    setStatus("ready");
  };

  const onAddCustomStep = () => {
    const nextIndex = steps.length + (editingStep ? 1 : 1);
    const custom: StepItem = {
      stepIndex: nextIndex,
      stepType: "custom",
      pageUrl: "",
      elementId: "",
      elementDom: "",
      mainTitle: "",
      subTitle: "",
    };
    setEditingStep(custom);
    setStatus("editing");
  };

  const onEndRecord = () => {
    if (status === "idle" || status === "picking") return;
    
    // 结束录制时断开 WebSocket 连接
    closeWsConnection(true);
    setWsConnected(false);
    
    setEditingStep(null);
    setLatestPickedStep(null);
    setStatus("finished");
    message.success("录制已结束，WebSocket 连接已断开");
  };

  const onExport = () => {
    const blob = new Blob([JSON.stringify(steps, null, 2)], { type: "application/json;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "record-steps.json";
    link.click();
    URL.revokeObjectURL(href);
  };

  return (
    <div className="record-step-panel">
      <header className="panel-header">
        <div>
          <h2 className="panel-title">录制面板（第二模块）</h2>
          <p className="panel-subtitle">用于录入指引步骤，不影响原有录制页面功能。</p>
        </div>
        <Space>
          <Badge status={wsConnected ? "success" : "error"} text={wsConnected ? "WS已连接" : "WS未连接"} />
          {!wsConnected && (
            <Button size="small" onClick={reconnectWs}>
              重连 WS
            </Button>
          )}
          <Tag className="status-tag" color={statusColorMap[status]}>
            状态：{status}
          </Tag>
        </Space>
      </header>

      <Card className="panel-block" title="录入准备">
        <Space.Compact className="url-row">
          <Input
            className="url-input"
            placeholder="请输入要打开的网址，如 https://example.com"
            value={targetUrl}
            defaultValue={targetUrl}
            disabled={disabled.targetUrlInput}
            onChange={(e) => setTargetUrl(e.target.value)}
          />
          <Button type="primary" loading={starting} disabled={disabled.start || starting} onClick={onStartRecord}>
            开始录入
          </Button>
        </Space.Compact>
      </Card>

      <Card className="panel-block" title="录制控制">
        <Space wrap>
          <Button disabled={disabled.pick} onClick={onPickCurrentStep}>
            拾取当前步骤
          </Button>
          <Button type="primary" disabled={disabled.finishCurrent} onClick={onFinishCurrentStep}>
            完成当前步骤
          </Button>
          <Button disabled={disabled.addCustom} onClick={onAddCustomStep}>
            新增自建步骤
          </Button>
          <Button danger disabled={disabled.finishRecord} onClick={onEndRecord}>
            结束录制
          </Button>
          <Button type="dashed" disabled={disabled.exportData} onClick={onExport}>
            导出
          </Button>
        </Space>
      </Card>

      <Row gutter={[12, 12]} className="panel-grid">
        <Col xs={24} lg={12}>
          <Card className="panel-block" title="步骤列表预览">
            {steps.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已完成步骤" />
            ) : (
              <List
                className="step-list"
                dataSource={steps}
                renderItem={(step) => (
                  <List.Item key={`${step.stepType}-${step.stepIndex}`}>
                    <div className="step-item">
                      <span>#{step.stepIndex}</span>
                      <Tag color={step.stepType === "picked" ? "blue" : "purple"}>{step.stepType}</Tag>
                      <span>{step.mainTitle || "未填写主标题"}</span>
                    </div>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card className="panel-block" title="当前步骤编辑">
            {!editingStep ? (
              latestPickedStep ? (
                <div className="form">
                  <Typography.Text type="secondary">最新拾取步骤（可点击“完成当前步骤”保存）</Typography.Text>
                  <Typography.Text strong>页面地址：</Typography.Text>
                  <Input value={latestPickedStep.pageUrl} disabled />
                  
                  <Typography.Text strong>元素选择器：</Typography.Text>
                  <Input value={latestPickedStep.elementId} disabled />
                  
                  <Typography.Text strong>元素DOM：</Typography.Text>
                  <Input.TextArea value={latestPickedStep.elementDom} disabled rows={3} />
                  
                  <Button 
                    type="primary" 
                    onClick={() => {
                      setEditingStep(latestPickedStep);
                      setStatus("editing");
                    }}
                    style={{ marginTop: '10px' }}
                  >
                    编辑此步骤
                  </Button>
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择“拾取当前步骤”或“新增自建步骤”" />
              )
            ) : (
              <div className="form">
                <Typography.Text type="secondary">步骤类型</Typography.Text>
                <Input value={editingStep.stepType} disabled />

                <Typography.Text type="secondary">页面地址（自建步骤可编辑）</Typography.Text>
                <Input value={editingStep.pageUrl} disabled={editingStep.stepType === "picked"} onChange={(e) => setEditingStep({ ...editingStep, pageUrl: e.target.value })} />

                <Typography.Text type="secondary">主标题</Typography.Text>
                <Input value={editingStep.mainTitle} onChange={(e) => setEditingStep({ ...editingStep, mainTitle: e.target.value })} />

                <Typography.Text type="secondary">副标题</Typography.Text>
                <Input.TextArea rows={3} value={editingStep.subTitle} onChange={(e) => setEditingStep({ ...editingStep, subTitle: e.target.value })} />

                <Typography.Text type="secondary">元素唯一ID（占位）</Typography.Text>
                <Input value={editingStep.elementId || "待后续算法确定"} disabled />

                <Typography.Text type="secondary">元素DOM信息（占位）</Typography.Text>
                <Input.TextArea value={editingStep.elementDom || "当前步骤为自建，暂无DOM信息"} disabled rows={4} />
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default RecordStepPanel;