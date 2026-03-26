private startHeartbeat(): void {
    this.stopHeartbeat(); // 确保没有重复的心跳
    
    // 定期发送 ping 消息
    this.heartbeatInterval = window.setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
                console.log('💓 发送心跳 ping');
                
                // 设置心跳超时检测
                this.heartbeatTimeout = window.setTimeout(() => {
                    console.warn('⚠️ 心跳超时，连接可能已断开');
                    if (this.ws) {
                        this.ws.close();
                    }
                }, this.heartbeatTimeoutMs);
            } catch (error) {
                console.error('❌ 心跳发送失败:', error);
                this.stopHeartbeat();
            }
        }
    }, this.heartbeatIntervalMs);
}