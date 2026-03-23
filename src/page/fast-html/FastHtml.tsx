// FastHtml.jsx（React前端组件）
import { message } from "antd";
import React, { useState } from "react";
import { openBrowser, startRecord, stopRecord } from "../https/requests";

const FastHtml = () => {
  const [targetUrl, setTargetUrl] = useState("https://xft.cmbchina.com/");
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // 启动浏览器（原有功能）
  const startBrowser = async () => {
    let fullUrl = targetUrl.trim();
    if (!fullUrl) {
      message.error("请输入目标URL");
      return;
    }
    if (!fullUrl.startsWith("http")) {
      fullUrl = "https://" + fullUrl;
    }
    try {
      const data = await openBrowser(fullUrl);
      alert(`浏览器已打开：${data.url}`);
    } catch (error) {
      console.error("前端触发录制失败：", error);
      // 简易方案：提示用户手动运行Node.js脚本
      alert("请在终端运行：node page-recorder.js 开始录制");
    }
  };

  // 开启录制
  const startRecordHandler = async () => {
    let fullUrl = targetUrl.trim();
    if (!fullUrl) {
      message.error("请输入目标URL");
      return;
    }
    if (!fullUrl.startsWith("http")) {
      fullUrl = "https://" + fullUrl;
    }

    setIsLoading(true);
    try {
      // 调用封装的后端接口触发录制
      await startRecord(fullUrl, true);
      setIsRecording(true);
      message.success(`录制已启动`);
    } catch (error: any) {
      console.error("前端触发录制失败：", error);
      message.error(error?.message || "录制启动失败，请检查服务是否运行");
    } finally {
      setIsLoading(false);
    }
  };

  // 关闭录制
  const stopRecordHandler = async () => {
    setIsLoading(true);
    try {
      await stopRecord();

      setIsRecording(false);
      message.success(`录制已停止`);
    } catch (error: any) {
      console.error("前端停止录制失败：", error);
      message.error(error?.message || "录制停止失败，请检查服务是否运行");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ padding: "20px" }}>
      <input
        placeholder="输入目标URL"
        style={{
          padding: "10px",
          marginRight: "10px",
          width: "300px",
        }}
        onChange={(e) => {
          setTargetUrl(e.target.value);
        }}
        defaultValue={"https://xft.cmbchina.com/"}
      />
      <div style={{ marginTop: "10px" }}>
        <button
          disabled={!targetUrl}
          onClick={startBrowser}
          style={{
            padding: "10px 20px",
            fontSize: "16px",
            marginRight: "10px",
          }}
        >
          启动浏览器
        </button>
        <button
          onClick={startRecordHandler}
          disabled={!targetUrl.trim() || isRecording || isLoading}
          style={{
            padding: "10px 20px",
            fontSize: "16px",
            marginRight: "10px",
            backgroundColor: isRecording ? "#bfbfbf" : "#1890ff",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: !targetUrl.trim() || isRecording || isLoading ? "not-allowed" : "pointer",
          }}
        >
          {isLoading && !isRecording ? "开启中..." : "开启录制"}
        </button>
        <button
          onClick={stopRecordHandler}
          disabled={!isRecording || isLoading}
          style={{
            padding: "10px 20px",
            fontSize: "16px",
            backgroundColor: isRecording ? "#ff4d4f" : "#bfbfbf",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: !isRecording || isLoading ? "not-allowed" : "pointer",
          }}
        >
          {isLoading && isRecording ? "关闭中..." : "关闭录制"}
        </button>
      </div>
      {isRecording && (
        <div
          style={{
            marginTop: "10px",
            padding: "8px 12px",
            backgroundColor: "#f6ffed",
            border: "1px solid #b7eb8f",
            borderRadius: "4px",
            color: "#52c41a",
          }}
        >
          录制进行中...
        </div>
      )}
    </div>
  );
};

export default FastHtml;