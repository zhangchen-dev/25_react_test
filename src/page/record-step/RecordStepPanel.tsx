import React, { useMemo, useState } from "react";
import { Button, Card, Col, Empty, Input, List, Row, Space, Tag, Typography, message } from "antd";
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

const buildMockPickedStep = (index: number, pageUrl: string): StepItem => ({
  stepIndex: index,
  stepType: "picked",
  pageUrl,
  elementId: `elem_mock_${Date.now()}_${index}`,
  elementDom: `<button id="mock-btn-${index}">示例按钮${index}</button>`,
  mainTitle: "",
  subTitle: "",
});

const statusColorMap: Record<PanelStatus, string> = {
  idle: "default",
  ready: "success",
  picking: "processing",
  editing: "warning",
  finished: "blue",
};

const RecordStepPanel: React.FC = () => {
  const [status, setStatus] = useState<PanelStatus>("idle");
  const [targetUrl, setTargetUrl] = useState("");
  const [steps, setSteps] = useState<StepItem[]>([]);
  const [editingStep, setEditingStep] = useState<StepItem | null>(null);
  const [starting, setStarting] = useState(false);

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
    [status, steps.length]
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
      const response = await fetch("http://localhost:3001/start-record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUrl: safeUrl,
          clearExisting: false,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.message || "启动录入失败");
      }

      setTargetUrl(safeUrl);
      setSteps([]);
      setEditingStep(null);
      setStatus("ready");
      message.success("已触发 start-record，Playwright 正在启动有头浏览器");
    } catch (error: any) {
      message.error(`启动失败：${error?.message || "请检查后端服务是否运行在 3001"}`);
    } finally {
      setStarting(false);
    }
  };

  const onPickCurrentStep = () => {
    if (status !== "ready") return;
    setStatus("picking");

    // 页面框架阶段：使用模拟数据表示“下一次点击已采集”
    setTimeout(() => {
      const nextIndex = steps.length + 1;
      const picked = buildMockPickedStep(nextIndex, targetUrl);
      setEditingStep(picked);
      setStatus("editing");
    }, 300);
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
    setEditingStep(null);
    setStatus("finished");
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
        <Tag className="status-tag" color={statusColorMap[status]}>
          状态：{status}
        </Tag>
      </header>

      <Card className="panel-block" title="录入准备">
        <Space.Compact className="url-row">
          <Input
            className="url-input"
            placeholder="请输入要打开的网址，如 https://example.com"
            value={targetUrl}
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
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择“拾取当前步骤”或“新增自建步骤”" />
            ) : (
              <div className="form">
                <Typography.Text type="secondary">步骤类型</Typography.Text>
                <Input value={editingStep.stepType} disabled />

                <Typography.Text type="secondary">页面地址（自建步骤可编辑）</Typography.Text>
                <Input
                  value={editingStep.pageUrl}
                  disabled={editingStep.stepType === "picked"}
                  onChange={(e) => setEditingStep({ ...editingStep, pageUrl: e.target.value })}
                />

                <Typography.Text type="secondary">主标题</Typography.Text>
                <Input
                  value={editingStep.mainTitle}
                  onChange={(e) => setEditingStep({ ...editingStep, mainTitle: e.target.value })}
                />

                <Typography.Text type="secondary">副标题</Typography.Text>
                <Input.TextArea
                  rows={3}
                  value={editingStep.subTitle}
                  onChange={(e) => setEditingStep({ ...editingStep, subTitle: e.target.value })}
                />

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

