"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { isConnected, getAddress, getNetwork, requestAccess, setAllowed } from "@stellar/freighter-api";

// Wallet types
export type WalletType = "freighter" | "xbull" | null;

export interface WalletState {
  isConnected: boolean;
  address: string | null;
  walletType: WalletType;
  network: string | null;
  isConnecting: boolean;
  error: string | null;
}

interface WalletContextType extends WalletState {
  connectFreighter: () => Promise<void>;
  connectXBull: () => Promise<void>;
  disconnect: () => Promise<void>;
  openModal: () => void;
  closeModal: () => void;
  isModalOpen: boolean;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

// xBull wallet interface
interface XBullWallet {
  connect: () => Promise<{ publicKey: string }>;
  disconnect: () => Promise<void>;
  getNetwork: () => Promise<string>;
}

declare global {
  interface Window {
    xBull?: XBullWallet;
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>({
    isConnected: false,
    address: null,
    walletType: null,
    network: null,
    isConnecting: false,
    error: null,
  });

  const [isModalOpen, setIsModalOpen] = useState(false);

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => setIsModalOpen(false), []);

  // Check for existing connection on mount
  useEffect(() => {
    const checkExistingConnection = async () => {
      try {
        // Check Freighter
        const connected = await isConnected();
        if (connected) {
          const addressResult = await getAddress();
          const networkResult = await getNetwork();
          
          if (addressResult && !addressResult.error) {
            setState({
              isConnected: true,
              address: addressResult.address,
              walletType: "freighter",
              network: networkResult.network,
              isConnecting: false,
              error: null,
            });
          }
        }
      } catch {
        // No existing connection
      }
    };
    checkExistingConnection();
  }, []);

  const connectFreighter = useCallback(async () => {
    setState((prev) => ({ ...prev, isConnecting: true, error: null }));

    try {
      // Check if Freighter is installed
      const connected = await isConnected();
      
      if (!connected) {
        // Request access - this will prompt user to connect
        const accessResult = await requestAccess();
        
        if (accessResult.error) {
          throw new Error(accessResult.error);
        }
        
        const networkResult = await getNetwork();
        
        setState({
          isConnected: true,
          address: accessResult.address,
          walletType: "freighter",
          network: networkResult.network,
          isConnecting: false,
          error: null,
        });
        closeModal();
      } else {
        // Already connected, get address
        const addressResult = await getAddress();
        const networkResult = await getNetwork();
        
        if (addressResult.error) {
          // Need to request access
          const accessResult = await requestAccess();
          
          if (accessResult.error) {
            throw new Error(accessResult.error);
          }
          
          setState({
            isConnected: true,
            address: accessResult.address,
            walletType: "freighter",
            network: networkResult.network,
            isConnecting: false,
            error: null,
          });
          closeModal();
        } else {
          setState({
            isConnected: true,
            address: addressResult.address,
            walletType: "freighter",
            network: networkResult.network,
            isConnecting: false,
            error: null,
          });
          closeModal();
        }
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        error: error instanceof Error ? error.message : "Failed to connect Freighter wallet",
      }));
    }
  }, [closeModal]);

  const connectXBull = useCallback(async () => {
    setState((prev) => ({ ...prev, isConnecting: true, error: null }));

    try {
      // Check if xBull is installed
      if (typeof window.xBull === "undefined") {
        throw new Error("xBull wallet is not installed. Please install xBull extension.");
      }

      const result = await window.xBull!.connect();
      const network = await window.xBull!.getNetwork();

      setState({
        isConnected: true,
        address: result.publicKey,
        walletType: "xbull",
        network: network,
        isConnecting: false,
        error: null,
      });
      closeModal();
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        error: error instanceof Error ? error.message : "Failed to connect xBull wallet",
      }));
    }
  }, [closeModal]);

  const disconnect = useCallback(async () => {
    // Note: Freighter doesn't have a disconnect method
    // We just clear the local state
    setState({
      isConnected: false,
      address: null,
      walletType: null,
      network: null,
      isConnecting: false,
      error: null,
    });
  }, []);

  return (
    <WalletContext.Provider
      value={{
        ...state,
        connectFreighter,
        connectXBull,
        disconnect,
        openModal,
        closeModal,
        isModalOpen,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
