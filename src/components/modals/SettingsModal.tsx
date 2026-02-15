'use client';

import React, { useEffect, useState } from 'react';
import { Baby } from '@prisma/client';
import { Settings } from '@/app/api/types';
import { Settings as SettingsIcon, Plus, Edit, Download, Upload, Smartphone, Copy, Trash2, Check } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/src/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/src/components/ui/select';
import BabyModal from '@/src/components/modals/BabyModal';
import ChangePinModal from '@/src/components/modals/ChangePinModal';

interface DeviceToken {
  id: string;
  tokenPreview: string;
  name: string;
  caretakerName: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  isActive: boolean;
}

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onBabySelect?: (babyId: string) => void;
  onBabyStatusChange?: () => void;
  selectedBabyId?: string;
  /**
   * Optional variant to control the modal styling
   */
  variant?: 'settings' | 'default';
}

export default function SettingsModal({
  open,
  onClose,
  onBabySelect,
  onBabyStatusChange,
  selectedBabyId,
  variant = 'default'
}: SettingsModalProps) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [babies, setBabies] = useState<Baby[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBabyModal, setShowBabyModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedBaby, setSelectedBaby] = useState<Baby | null>(null);
  const [localSelectedBabyId, setLocalSelectedBabyId] = useState<string | undefined>(selectedBabyId);
  const [showChangePinModal, setShowChangePinModal] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Device token state
  const [deviceTokens, setDeviceTokens] = useState<DeviceToken[]>([]);
  const [newTokenName, setNewTokenName] = useState('');
  const [newlyCreatedUrl, setNewlyCreatedUrl] = useState<string | null>(null);
  const [isCreatingToken, setIsCreatingToken] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  useEffect(() => {
    setLocalSelectedBabyId(selectedBabyId);
  }, [selectedBabyId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [settingsResponse, babiesResponse] = await Promise.all([
        fetch('/api/settings'),
        fetch('/api/baby')
      ]);

      if (settingsResponse.ok) {
        const settingsData = await settingsResponse.json();
        setSettings(settingsData.data);
      }

      if (babiesResponse.ok) {
        const babiesData = await babiesResponse.json();
        setBabies(babiesData.data);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchDeviceTokens = async () => {
    try {
      const response = await fetch('/api/device-tokens');
      if (response.ok) {
        const data = await response.json();
        setDeviceTokens(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching device tokens:', error);
    }
  };

  // Fetch data when modal opens
  useEffect(() => {
    if (open) {
      fetchData();
      fetchDeviceTokens();
      setNewlyCreatedUrl(null);
      setNewTokenName('');
    }
  }, [open]);

  const handleSettingsChange = async (updates: Partial<Settings>) => {
    try {
      const response = await fetch('/api/settings', {
        method: settings ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...settings, ...updates }),
      });

      if (response.ok) {
        const data = await response.json();
        setSettings(data.data);
      }
    } catch (error) {
      console.error('Error updating settings:', error);
    }
  };

  const handleBabyModalClose = async () => {
    setShowBabyModal(false);
    await fetchData(); // Refresh local babies list
    onBabyStatusChange?.(); // Refresh parent's babies list
  };

  const handleBackup = async () => {
    try {
      const response = await fetch('/api/database');
      if (!response.ok) throw new Error('Backup failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = response.headers.get('Content-Disposition')?.split('filename=')[1].replace(/"/g, '') || 'baby-tracker-backup.db';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Backup error:', error);
      alert('Failed to create backup');
    }
  };

  const handleRestore = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsRestoring(true);
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/database', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Restore failed');
      }

      // Refresh the page to reflect the restored data
      window.location.reload();
    } catch (error) {
      console.error('Restore error:', error);
      alert('Failed to restore backup');
    } finally {
      setIsRestoring(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleCreateDeviceToken = async () => {
    if (!newTokenName.trim()) return;
    setIsCreatingToken(true);
    try {
      const response = await fetch('/api/device-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTokenName.trim() }),
      });
      if (response.ok) {
        const data = await response.json();
        const kindleUrl = `${window.location.origin}/kindle/${data.data.token}`;
        setNewlyCreatedUrl(kindleUrl);
        setNewTokenName('');
        fetchDeviceTokens();
      } else {
        const errorData = await response.json();
        alert(errorData.error || 'Failed to create token');
      }
    } catch (error) {
      console.error('Error creating device token:', error);
      alert('Failed to create device token');
    } finally {
      setIsCreatingToken(false);
    }
  };

  const handleRevokeToken = async (id: string) => {
    if (!confirm('Revoke this device token? The device will no longer be able to access the tracker.')) return;
    try {
      const response = await fetch(`/api/device-tokens?id=${id}`, { method: 'DELETE' });
      if (response.ok) {
        fetchDeviceTokens();
      }
    } catch (error) {
      console.error('Error revoking device token:', error);
    }
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    } catch {
      // Fallback for browsers without clipboard API
      const textArea = document.createElement('textarea');
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  const formatTimeAgo = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        accept=".db"
        onChange={handleRestore}
        style={{ display: 'none' }}
      />
      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            onBabyStatusChange?.(); // Refresh parent's babies list when settings modal closes
          }
          onClose();
        }}
      >
        <DialogContent className="dialog-content max-w-2xl w-full">
          <DialogHeader className="dialog-header">
            <DialogTitle className="dialog-title text-slate-800">Settings</DialogTitle>
            <DialogDescription className="dialog-description">
              Configure your preferences for the Baby Tracker app
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 w-full max-w-lg mx-auto">
            <div className="space-y-4">
              <div>
                <Label className="form-label">Family Name</Label>
                <Input
                  disabled={loading}
                  value={settings?.familyName || ''}
                  onChange={(e) => handleSettingsChange({ familyName: e.target.value })}
                  placeholder="Enter family name"
                  className="w-full"
                />
              </div>

              <div>
                <Label className="form-label">Security PIN</Label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    disabled
                    value="••••••"
                    className="w-full font-mono"
                  />
                  <Button
                    variant="outline"
                    onClick={() => setShowChangePinModal(true)}
                    disabled={loading}
                  >
                    Change PIN
                  </Button>
                </div>
                <p className="text-sm text-gray-500 mt-1">PIN must be between 6 and 10 digits</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleBackup}
                  className="w-full"
                  disabled={loading}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Backup Database
                </Button>
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full"
                  disabled={loading || isRestoring}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Restore Database
                </Button>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-6">
              <h3 className="form-label mb-4">Manage Babies</h3>
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 w-full">
                  <div className="flex-1 min-w-[200px]">
                    <Select
                      value={localSelectedBabyId}
                      onValueChange={(babyId) => {
                        setLocalSelectedBabyId(babyId);
                        onBabySelect?.(babyId);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a baby" />
                      </SelectTrigger>
                      <SelectContent>
                        {babies.map((baby) => (
                          <SelectItem key={baby.id} value={baby.id}>
                            {baby.firstName} {baby.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="outline"
                    disabled={!localSelectedBabyId}
                    onClick={() => {
                      const baby = babies.find(b => b.id === localSelectedBabyId);
                      setSelectedBaby(baby || null);
                      setIsEditing(true);
                      setShowBabyModal(true);
                    }}
                  >
                    <Edit className="h-4 w-3 mr-2" />
                    Edit
                  </Button>
                  <Button variant="outline" onClick={() => {
                    setIsEditing(false);
                    setSelectedBaby(null);
                    setShowBabyModal(true);
                  }}>
                    <Plus className="h-4 w-3 mr-2" />
                    Add
                  </Button>
                </div>
              </div>
            </div>

            {/* Device Tokens Section */}
            <div className="border-t border-slate-200 pt-6">
              <h3 className="form-label mb-2 flex items-center gap-2">
                <Smartphone className="h-4 w-4" />
                Device Tokens
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                Create tokens for devices like Kindle to log activities without signing in.
              </p>

              {/* Create new token */}
              <div className="flex gap-2 mb-4">
                <Input
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  placeholder='Device name (e.g. "Bedroom Kindle")'
                  className="flex-1"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateDeviceToken()}
                />
                <Button
                  variant="outline"
                  onClick={handleCreateDeviceToken}
                  disabled={isCreatingToken || !newTokenName.trim()}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Create
                </Button>
              </div>

              {/* Show newly created URL */}
              {newlyCreatedUrl && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                  <p className="text-sm font-medium text-green-800 mb-1">✅ Token created! Copy this URL to your device:</p>
                  <div className="flex gap-2 items-center">
                    <code className="text-xs bg-green-100 text-green-900 px-2 py-1 rounded flex-1 break-all">
                      {newlyCreatedUrl}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyUrl(newlyCreatedUrl)}
                      className="shrink-0"
                    >
                      {copiedToken ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-green-700 mt-1">⚠️ This URL is only shown once. Copy it now!</p>
                </div>
              )}

              {/* Token list */}
              {deviceTokens.length > 0 && (
                <div className="space-y-2">
                  {deviceTokens.map((token) => (
                    <div
                      key={token.id}
                      className={`flex items-center justify-between p-3 rounded-lg border ${token.isActive
                          ? 'bg-white border-slate-200'
                          : 'bg-gray-50 border-gray-200 opacity-60'
                        }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`inline-block w-2 h-2 rounded-full ${token.isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                          <span className="font-medium text-sm text-slate-800 truncate">{token.name}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1 ml-4">
                          {token.isActive ? (
                            <>Last used: {formatTimeAgo(token.lastUsedAt)}</>
                          ) : (
                            <span className="text-red-500">Revoked</span>
                          )}
                        </div>
                      </div>
                      {token.isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevokeToken(token.id)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {deviceTokens.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-2">No device tokens yet</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <BabyModal
        open={showBabyModal}
        onClose={handleBabyModalClose}
        isEditing={isEditing}
        baby={selectedBaby}
      />

      <ChangePinModal
        open={showChangePinModal}
        onClose={() => setShowChangePinModal(false)}
        currentPin={settings?.securityPin || '111222'}
        onPinChange={(newPin) => handleSettingsChange({ securityPin: newPin })}
      />
    </>
  );
}

